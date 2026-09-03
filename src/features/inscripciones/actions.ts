"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireManage } from "@/features/events/lib/access";
import { pasoSiguiente } from "@/features/events/lib/asistente";
import { cifrar, hayLlaveDeCifrado } from "@/features/pagos/lib/cifrado";
import { ADAPTADORES } from "@/features/pagos/adapters";
import type { PaymentProvider } from "@/lib/supabase/types";

/**
 * Acciones de inscripcion.
 *
 * Todas llaman a una funcion de Postgres. Las tablas no tienen GRANT de insert
 * ni de update, asi que no hay forma de escribirlas desde aca aunque uno se
 * distraiga: quien decide es la base.
 *
 * Los mensajes de error de esas funciones estan escritos para que los lea una
 * persona ("Esta categoría no tiene cupos disponibles"), asi que se pasan tal
 * cual en vez de reemplazarlos por un generico.
 */

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo completar la operación.";
  if (error.code === "42501") return "Hay que entrar con una cuenta.";
  if (error.code === "23505") return "Ese lugar ya está ocupado.";
  return error.message || "No se pudo completar la operación.";
}

function refrescar(registrationId: string) {
  revalidatePath(`/inscripcion/${registrationId}`);
  revalidatePath("/mis-inscripciones");
}

export async function empezarInscripcion(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const divisionId = String(formData.get("divisionId") ?? "");
  const teamName = String(formData.get("teamName") ?? "").trim() || null;

  if (!divisionId) return { error: "Elige una categoría." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_registration", {
    p_division_id: divisionId,
    p_team_name: teamName ?? undefined,
  });

  if (error || !data) return { error: traducir(error) };

  const registro = data as unknown as { id: string };
  revalidatePath("/mis-inscripciones");
  redirect(`/inscripcion/${registro.id}`);
}

export async function invitarIntegrante(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const registrationId = String(formData.get("registrationId") ?? "");
  const position = Number(formData.get("position") ?? 0);
  const email = String(formData.get("email") ?? "").trim();

  if (!email) return { error: "Escribe el correo del integrante." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_member", {
    p_registration_id: registrationId,
    p_position: position,
    p_email: email,
  });

  if (error) return { error: traducir(error) };

  refrescar(registrationId);
  return OK;
}

export async function guardarMisDatos(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const registrationId = String(formData.get("registrationId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");

  const datos = {
    firstName: String(formData.get("firstName") ?? "").trim(),
    lastName: String(formData.get("lastName") ?? "").trim(),
    birthDate: String(formData.get("birthDate") ?? "").trim(),
    gender: String(formData.get("gender") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim(),
    shirtSize: String(formData.get("shirtSize") ?? "").trim(),
    acceptTerms: formData.get("acceptTerms") === "on",
    // Los campos extra del organizador viajan juntos: son datos, no columnas.
    answers: Object.fromEntries(
      [...formData.entries()]
        .filter(([k]) => k.startsWith("campo-"))
        .map(([k, v]) => [k.slice(6), String(v)]),
    ),
  };

  if (!datos.firstName || !datos.lastName) {
    return { error: "El nombre y el apellido son obligatorios." };
  }
  if (!datos.acceptTerms) {
    return { error: "Hay que aceptar los términos para poder competir." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_member_data", {
    p_member_id: memberId,
    p_datos: datos as never,
  });

  if (error) return { error: traducir(error) };

  refrescar(registrationId);
  return OK;
}

export async function enviarInscripcion(
  registrationId: string,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_registration", {
    p_registration_id: registrationId,
  });

  if (error) return { error: traducir(error) };

  refrescar(registrationId);
  return OK;
}

export async function cancelarInscripcion(
  registrationId: string,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_registration", {
    p_registration_id: registrationId,
  });

  if (error) return { error: traducir(error) };

  refrescar(registrationId);
  return OK;
}

/**
 * Enlaza al usuario que entra con el lugar que le reservaron por correo.
 *
 * Se llama sola al abrir una inscripcion. Es idempotente y no falla si el lugar
 * no es suyo: en ese caso simplemente no pasa nada y la pantalla le muestra lo
 * que si puede ver.
 */
export async function reclamarLugar(
  registrationId: string,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_membership", {
    p_registration_id: registrationId,
  });
  if (error) return { error: error.message || traducir(error) };

  refrescar(registrationId);
  return OK;
}

/** Confirma a mano una inscripción que quedó esperando pago. */
export async function confirmarInscripcion(
  registrationId: string,
  eventId: string,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_registration", {
    p_registration_id: registrationId,
  });

  if (error) return { error: traducir(error) };

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  return OK;
}

/**
 * El precio de TODAS las categorias, en un solo envio.
 *
 * Antes cada categoria tenia su propio formulario y su propio boton "Guardar":
 * con diez categorias eran diez botones identicos uno debajo del otro, y nada
 * decia cual ya se habia guardado y cual no. Un solo lote, un solo boton, un
 * solo upsert — supabase-js manda un arreglo de filas en UN viaje de red, asi
 * que N categorias siguen siendo una sola escritura.
 *
 * El precio se escribe en la moneda de verdad y se guarda en centavos: guardar
 * plata en decimales es como se pierden centavos al redondear.
 */
export async function guardarPreciosDeCategorias(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const divisionIds = String(formData.get("divisionIds") ?? "")
    .split(",")
    .filter(Boolean);

  const filas: Array<{
    division_id: string;
    event_id: string;
    price_cents: number | null;
  }> = [];

  for (const divisionId of divisionIds) {
    const precio = String(formData.get(`precio_${divisionId}`) ?? "").trim();
    const priceCents = precio === "" ? null : Math.round(Number(precio) * 100);
    if (
      priceCents !== null &&
      (!Number.isFinite(priceCents) || priceCents < 0)
    ) {
      return { error: "Uno de los precios no es válido." };
    }
    filas.push({
      division_id: divisionId,
      event_id: eventId,
      price_cents: priceCents,
    });
  }

  if (filas.length === 0) return OK;

  const supabase = await createClient();
  // La moneda NO viaja: la pone el trigger desde `events.currency`. El cupo y
  // los cambios de integrante se configuran en la categoria, y mandarlos vacios
  // desde aca los borraria.
  const { error } = await supabase
    .from("division_registration")
    .upsert(filas, { onConflict: "division_id" });

  if (error) return { error: traducir(error) };

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  revalidatePath(`/panel/asistente/${eventId}`, "layout");
  return OK;
}

/**
 * El paso "Inscripcion" del asistente, ENTERO, en un solo envio.
 *
 * Moneda, medio de cobro y precios tenian cada uno su propio boton "Guardar":
 * en el asistente eso se sentia como llenar un formulario y tener que
 * confirmar cuatro veces antes de poder avanzar. Aca el boton "Continuar" del
 * asistente ES el submit — no hay ningun "Guardar" suelto en la pantalla — y
 * esta funcion hace las tres escrituras y recien despues redirige al resumen.
 *
 * LOS CODIGOS DE DESCUENTO QUEDAN AFUERA a proposito: crear un codigo es
 * agregar un item a una lista que puede seguir creciendo despues, igual que
 * "Nueva categoria" o subir un documento — no es un campo del paso que haya
 * que "continuar" para guardar, y meterlo aca forzaria a elegir entre crear el
 * codigo o avanzar de paso.
 *
 * Esta funcion vive junto al resto de acciones de inscripcion aunque toque
 * `events` y `payment_providers`: es la unica que orquesta las tres tablas del
 * paso, y separarla en tres llamadas —una por tabla— es exactamente lo que el
 * asistente ya no quiere mostrar.
 */
export async function guardarPasoInscripcion(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const orgId = String(formData.get("orgId") ?? "");

  await requireManage(eventId);

  const supabase = await createClient();

  // --- 1. Moneda -------------------------------------------------------
  const currency = String(formData.get("currency") ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: "Elige una moneda." };
  }

  const { error: errorMoneda } = await supabase
    .from("events")
    .update({ currency })
    .eq("id", eventId);
  if (errorMoneda) return { error: traducir(errorMoneda) };

  // --- 2. Medio de cobro -------------------------------------------------
  // Optativo: si el organizador no toco esta seccion, no se crea una fila
  // vacia de `payment_providers` solo porque el formulario se envio igual.
  const provider = String(formData.get("provider") ?? "") as PaymentProvider;
  const adaptador = ADAPTADORES[provider];

  if (orgId && adaptador) {
    const activo = formData.get("activo") === "on";
    const secreto = String(formData.get("secreto") ?? "").trim();
    const publicConfig = Object.fromEntries(
      adaptador.camposPublicos.map((c) => [
        c.key,
        String(formData.get(`campo-${c.key}`) ?? "").trim(),
      ]),
    );
    const hayAlgoQueGuardar =
      activo || secreto || Object.values(publicConfig).some(Boolean);

    const { data: existente } = await supabase
      .from("payment_providers")
      .select("id")
      .eq("org_id", orgId)
      .eq("provider", provider)
      .maybeSingle();

    if (existente || hayAlgoQueGuardar) {
      if (secreto && !hayLlaveDeCifrado()) {
        return {
          error:
            "Falta configurar PAYMENTS_ENCRYPTION_KEY en el servidor. Sin esa clave no se pueden guardar credenciales.",
        };
      }

      const fila = {
        org_id: orgId,
        provider,
        public_config: publicConfig,
        active: activo,
        // Vacio significa "dejalo como estaba", no "borralo" — igual que en
        // `guardarProveedor`.
        ...(secreto ? { secret_ciphertext: cifrar(secreto) } : {}),
      };

      const { error: errorProveedor } = existente
        ? await supabase
            .from("payment_providers")
            .update(fila)
            .eq("id", existente.id)
        : await supabase.from("payment_providers").insert(fila);

      if (errorProveedor) return { error: traducir(errorProveedor) };
    }
  }

  // --- 3. Precio por categoria --------------------------------------------
  const divisionIds = String(formData.get("divisionIds") ?? "")
    .split(",")
    .filter(Boolean);

  if (divisionIds.length > 0) {
    const filas: Array<{
      division_id: string;
      event_id: string;
      price_cents: number | null;
    }> = [];

    for (const divisionId of divisionIds) {
      const precio = String(formData.get(`precio_${divisionId}`) ?? "").trim();
      const priceCents =
        precio === "" ? null : Math.round(Number(precio) * 100);
      if (
        priceCents !== null &&
        (!Number.isFinite(priceCents) || priceCents < 0)
      ) {
        return { error: "Uno de los precios no es válido." };
      }
      filas.push({
        division_id: divisionId,
        event_id: eventId,
        price_cents: priceCents,
      });
    }

    const { error: errorPrecios } = await supabase
      .from("division_registration")
      .upsert(filas, { onConflict: "division_id" });
    if (errorPrecios) return { error: traducir(errorPrecios) };
  }

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  revalidatePath(`/panel/asistente/${eventId}`, "layout");
  redirect(
    `/panel/asistente/${eventId}/${pasoSiguiente("inscripcion")?.slug ?? "resumen"}`,
  );
}
