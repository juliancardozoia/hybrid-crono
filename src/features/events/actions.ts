"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugWithSuffix } from "@/shared/utils/slug";
import { pasoSiguiente } from "@/features/events/lib/asistente";
import { instanteEnZona } from "@/shared/utils/fecha";
import { requireManage } from "@/features/events/lib/access";
import type { EventFormat, EventType } from "@/lib/supabase/types";
import { TALLAS } from "./lib/tallas";

export interface FormState {
  error: string | null;
}

function texto(formData: FormData, campo: string): string | null {
  return String(formData.get(campo) ?? "").trim() || null;
}

/**
 * Los campos de la ficha del evento, listos para escribir.
 *
 * Vive aparte porque los usan el alta y la edicion, y porque las fechas
 * necesitan el huso: un `datetime-local` da hora de pared, y guardarla como si
 * fuera UTC corre la largada varias horas.
 */
function camposDeLaFicha(formData: FormData) {
  const timezone = texto(formData, "timezone") ?? "America/Bogota";
  const cuando = (campo: string) => {
    const local = texto(formData, campo);
    return local ? instanteEnZona(local, timezone) : null;
  };

  return {
    name: String(formData.get("name") ?? "").trim(),
    description: texto(formData, "description"),
    event_type: (texto(formData, "eventType") ?? "presencial") as EventType,
    // Sin fallback silencioso a proposito: el formato decide si la
    // competencia corre un circuito o pruebas de CrossFit, y elegirlo sin
    // que el organizador se de cuenta es justo el bug que esto evita. La
    // validacion de que no venga vacio esta en `validar()`.
    format: (texto(formData, "format") ?? "") as EventFormat,
    timezone,
    country: texto(formData, "country"),
    state: texto(formData, "state"),
    city: texto(formData, "city"),
    address: texto(formData, "address"),
    venue: texto(formData, "venue"),
    starts_at: cuando("startsAt"),
    ends_at: cuando("endsAt"),
    registration_opens_at: cuando("registrationOpensAt"),
    registration_closes_at: cuando("registrationClosesAt"),
    organizer_name: texto(formData, "organizerName"),
    organizer_phone_country: texto(formData, "organizerPhoneCountry"),
    organizer_phone: texto(formData, "organizerPhone"),
    instagram: texto(formData, "instagram")?.replace(/^@/, "") ?? null,
    website: texto(formData, "website"),
    logo_url: texto(formData, "logoUrl"),
    cover_url: texto(formData, "coverUrl"),
    shirt_sizes: TALLAS.filter((t) => formData.get(`talla-${t}`) === "on"),
    auto_tiebreak: formData.get("autoTiebreak") === "on",
  };
}

/** Lo que el organizador puede provocar y conviene explicarle. */
function validar(campos: ReturnType<typeof camposDeLaFicha>, formData: FormData): string | null {
  if (campos.name.length < 3) return "El nombre tiene que tener al menos 3 caracteres.";
  if (!campos.format) return "Elige el formato de la competencia.";

  for (const [campo, etiqueta] of [
    ["startsAt", "de inicio"],
    ["endsAt", "de fin"],
    ["registrationOpensAt", "de apertura de inscripciones"],
    ["registrationClosesAt", "de cierre de inscripciones"],
  ] as const) {
    const local = texto(formData, campo);
    if (local && !instanteEnZona(local, campos.timezone)) {
      return `La fecha ${etiqueta} no es válida.`;
    }
  }

  if (campos.starts_at && campos.ends_at && campos.starts_at > campos.ends_at) {
    return "La competencia no puede terminar antes de empezar.";
  }
  if (
    campos.registration_opens_at &&
    campos.registration_closes_at &&
    campos.registration_opens_at > campos.registration_closes_at
  ) {
    return "Las inscripciones no pueden cerrar antes de abrir.";
  }

  return null;
}

function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo guardar.";
  if (error.code === "23505") return "Ya existe una competencia con ese nombre.";
  if (error.code === "23514") return "Algún dato está fuera de rango.";
  if (error.code === "42501") return "No tienes permiso para esta operación.";
  return "No se pudo guardar.";
}

export async function createEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const orgId = String(formData.get("orgId") ?? "");
  if (!orgId) return { error: "Falta la organización." };

  const campos = camposDeLaFicha(formData);
  const problema = validar(campos, formData);
  if (problema) return { error: problema };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .insert({
      ...campos,
      org_id: orgId,
      // Sufijo aleatorio siempre: dos ediciones del mismo evento no pueden
      // chocar, y un link filtrado se puede rotar.
      public_slug: slugWithSuffix(campos.name, 64),
    })
    .select("id")
    .single();

  if (error || !data) return { error: traducir(error) };

  revalidatePath("/panel");
  // Al paso SIGUIENTE segun la lista, no a uno escrito a mano: cuando entro
  // "documentos" entre medio, el destino fijo lo salteaba y esa pantalla no la
  // veia nadie. Un paso opcional se puede saltear, pero eso lo decide quien lo
  // usa. El evento ya existe en borrador, asi que cerrar el navegador no pierde
  // nada.
  redirect(`/panel/asistente/${data.id}/${pasoSiguiente("general")?.slug ?? "resumen"}`);
}

/**
 * Guarda la ficha y avanza al paso siguiente del asistente.
 *
 * Es el UNICO lugar que la usa: el boton no dice "Guardar", dice "Continuar" —
 * el mismo submit hace las dos cosas, y no hay un boton aparte que guarde sin
 * avanzar. Si en algun momento la ficha se vuelve a editar FUERA del asistente,
 * esta funcion deja de servir ahi y hace falta una que solo revalide.
 */
export async function updateEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const campos = camposDeLaFicha(formData);
  const problema = validar(campos, formData);
  if (problema) return { error: problema };

  const supabase = await createClient();
  const { error } = await supabase.from("events").update(campos).eq("id", eventId);

  if (error) return { error: traducir(error) };

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  redirect(`/panel/asistente/${eventId}/${pasoSiguiente("general")?.slug ?? "resumen"}`);
}

/**
 * Publicar es distinto de poner en vivo.
 *
 * `status` dice en que momento de su vida esta la competencia; `published_at`
 * dice si el organizador decidio mostrarla al mundo. Una competencia interna
 * corre entera —se configura, se cronometra, se verifica— sin aparecer nunca en
 * el catalogo.
 *
 * En una fase posterior publicar va a exigir plan pago y tarjeta registrada.
 * Hoy solo exige que la competencia tenga fecha y categorias, que es lo minimo
 * para que un atleta que la abre pueda hacer algo con ella.
 */
export async function togglePublicacion(
  eventId: string,
  publicar: boolean,
): Promise<{ error: string | null }> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = publicar
    ? await supabase.rpc("publish_event", { p_event_id: eventId })
    : await supabase.rpc("unpublish_event", { p_event_id: eventId });

  if (error) {
    // El mensaje de la funcion dice exactamente que falta, asi que se pasa tal
    // cual en vez de reemplazarlo por un generico.
    return { error: error.message || "No se pudo cambiar la publicación." };
  }

  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  revalidatePath("/");
  return { error: null };
}
