"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManage } from "@/features/events/lib/access";
import { cifrar, hayLlaveDeCifrado } from "./lib/cifrado";
import { ADAPTADORES } from "./adapters";
import type { DiscountKind, PaymentProvider } from "@/lib/supabase/types";

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo guardar.";
  if (error.code === "23505")
    return "Ya existe una configuración para ese medio de pago.";
  if (error.code === "42501") return "No tienes permiso para esta operación.";
  return error.message || "No se pudo guardar.";
}

/**
 * Guarda la configuracion de una pasarela.
 *
 * El secreto se cifra ACA, antes de tocar la base: Postgres nunca ve el texto
 * plano. Y si no hay llave de cifrado configurada, la accion falla en vez de
 * guardar en claro — es la unica respuesta aceptable.
 */
export async function guardarProveedor(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const orgId = String(formData.get("orgId") ?? "");
  const provider = String(formData.get("provider") ?? "") as PaymentProvider;
  const label = String(formData.get("label") ?? "").trim() || null;
  const secreto = String(formData.get("secreto") ?? "").trim();

  const adaptador = ADAPTADORES[provider];
  if (!adaptador) return { error: "Ese medio de pago no existe." };

  if (secreto && !hayLlaveDeCifrado()) {
    return {
      error:
        "Falta configurar PAYMENTS_ENCRYPTION_KEY en el servidor. Sin esa clave no se pueden guardar credenciales.",
    };
  }

  const publicConfig = Object.fromEntries(
    adaptador.camposPublicos.map((c) => [
      c.key,
      String(formData.get(`campo-${c.key}`) ?? "").trim(),
    ]),
  );

  const supabase = await createClient();

  const fila = {
    org_id: orgId,
    provider,
    label,
    public_config: publicConfig,
    active: formData.get("activo") === "on",
    // Un campo de secreto vacio significa "dejalo como estaba", no "borralo":
    // si no, editar el numero de cuenta borraria la credencial sin avisar.
    ...(secreto ? { secret_ciphertext: cifrar(secreto) } : {}),
  };

  const { data: existente } = await supabase
    .from("payment_providers")
    .select("id")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();

  const { error } = existente
    ? await supabase
        .from("payment_providers")
        .update(fila)
        .eq("id", existente.id)
    : await supabase.from("payment_providers").insert(fila);

  if (error) return { error: traducir(error) };

  // Los medios de cobro son de la organizacion pero se configuran dentro de
  // una competencia, asi que se refresca el panel entero.
  revalidatePath("/panel", "layout");
  return OK;
}

export async function borrarProveedor(
  orgId: string,
  id: string,
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("payment_providers")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  revalidatePath("/panel", "layout");
}

// --- Códigos de descuento ---------------------------------------------------

export async function crearCodigo(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const code = String(formData.get("code") ?? "").trim();
  const kind = String(formData.get("kind") ?? "porcentaje") as DiscountKind;
  const valorBruto = String(formData.get("valor") ?? "").trim();
  const maxUses = String(formData.get("maxUses") ?? "").trim();
  const validTo = String(formData.get("validTo") ?? "").trim();
  // Vacio = toda la competencia. La columna ya es nullable con ese
  // significado; lo unico que faltaba era ofrecerlo.
  const divisionId = String(formData.get("divisionId") ?? "").trim() || null;

  if (!/^[A-Za-z0-9_-]{3,32}$/.test(code)) {
    return {
      error: "El código va sin espacios ni acentos, entre 3 y 32 caracteres.",
    };
  }

  const valor = Number(valorBruto);
  if (!Number.isFinite(valor) || valor <= 0)
    return { error: "El valor tiene que ser mayor que cero." };
  if (kind === "porcentaje" && valor > 100)
    return { error: "Un porcentaje no puede pasar de 100." };

  const supabase = await createClient();
  const { error } = await supabase.from("discount_codes").insert({
    event_id: eventId,
    code,
    kind,
    // Un monto se escribe en la moneda de verdad y se guarda en centavos.
    value: kind === "porcentaje" ? Math.round(valor) : Math.round(valor * 100),
    division_id: divisionId,
    max_uses: maxUses ? Number(maxUses) : null,
    valid_to: validTo ? new Date(validTo).toISOString() : null,
  });

  if (error) return { error: traducir(error) };

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  return OK;
}

export async function borrarCodigo(
  eventId: string,
  id: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase.from("discount_codes").delete().eq("id", id);
  if (error) return { error: traducir(error) };

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  return OK;
}

// --- La orden del atleta ----------------------------------------------------

export async function armarOrden(
  registrationId: string,
  codigo?: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_order", {
    p_registration_id: registrationId,
    p_code: codigo || undefined,
  });

  if (error) return { error: error.message || "No se pudo preparar el pago." };

  revalidatePath(`/inscripcion/${registrationId}`);
  return OK;
}

/** La organización marca una transferencia como recibida. */
export async function confirmarPagoManual(
  orderId: string,
  eventId: string,
  referencia?: string,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirmar_pago_manual", {
    p_order_id: orderId,
    p_referencia: referencia || undefined,
  });

  if (error) return { error: error.message || "No se pudo confirmar el pago." };

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  return OK;
}

/**
 * La moneda de la competencia.
 *
 * Un trigger la baja a todas las categorias. Sin eso, cambiarla aqui dejaria los
 * precios viejos etiquetados en la moneda nueva: "180.000" pasaria de pesos
 * colombianos a dolares sin que nadie tocara el numero.
 */
export async function guardarMonedaDelEvento(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const currency = String(formData.get("currency") ?? "")
    .trim()
    .toUpperCase();

  await requireManage(eventId);
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "Elige una moneda." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({ currency })
    .eq("id", eventId);

  if (error) return { error: traducir(error) };

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  return OK;
}
