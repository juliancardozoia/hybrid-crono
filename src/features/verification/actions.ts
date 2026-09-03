"use server";

import { revalidatePath } from "next/cache";
import { requireEventAccess, requireManage } from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";
import { recomputeLanes } from "./lib/recompute";

export interface FormState {
  error: string | null;
  mensaje?: string | null;
}

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
}

export async function verifyResults(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const divisionId = String(formData.get("divisionId") ?? "") || null;

  const access = await requireEventAccess(eventId);
  if (!access.canVerify) return { error: "No tienes permiso para verificar." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("verify_results", {
    p_event_id: eventId,
    p_division_id: divisionId as string,
  });

  if (error) return { error: "No se pudieron verificar los resultados." };

  refrescar(eventId);
  return { error: null, mensaje: `${data ?? 0} resultado(s) verificados.` };
}

/**
 * Publica el oficial y pasa el evento a "publicado".
 *
 * El snapshot que guarda publish_results es inmutable: desde aquí en adelante el
 * podio anunciado no depende de la tabla `results`. Si después se corrige algo,
 * hay que publicar de nuevo y esa republicación queda registrada aparte.
 */
export async function publishResults(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const divisionId = String(formData.get("divisionId") ?? "") || null;

  await requireManage(eventId);

  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_results", {
    p_event_id: eventId,
    p_division_id: divisionId as string,
  });

  if (error) return { error: "No se pudieron publicar los resultados." };

  // Solo se marca el evento entero como publicado cuando se publica todo.
  if (!divisionId) {
    await supabase.from("events").update({ status: "published" }).eq("id", eventId);
  }

  refrescar(eventId);
  return { error: null, mensaje: "Resultados publicados." };
}

/** Anula un marcaje. Exige motivo: queda en el log para siempre. */
export async function voidTimingEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const timingEventId = String(formData.get("timingEventId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  const access = await requireEventAccess(eventId);
  if (!access.canVerify) return { error: "No tienes permiso para anular marcajes." };
  if (reason.length < 3) return { error: "Escribe el motivo de la anulación." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("void_timing_event", {
    p_timing_event_id: timingEventId,
    p_reason: reason,
  });

  if (error) return { error: "No se pudo anular el marcaje." };

  refrescar(eventId);
  return { error: null, mensaje: "Marcaje anulado. Recalcula el resultado del carril." };
}

/** Fuerza el recálculo del cache de resultados de todo el evento. */
export async function recomputeEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const access = await requireEventAccess(eventId);
  if (!access.canVerify) return { error: "No tienes permiso." };

  const supabase = await createClient();
  const { data: heats } = await supabase.from("heats").select("id").eq("event_id", eventId);

  let total = 0;

  // Se recalcula heat por heat en vez de todo de una: un evento grande son
  // cientos de carriles. Y se llama a la funcion directo, no por HTTP: un
  // server action que le hiciera fetch a su propia API no llevaria las cookies
  // de sesion y se comeria un 401.
  for (const heat of heats ?? []) {
    const { recalculados } = await recomputeLanes({ heatId: heat.id });
    total += recalculados;
  }
  refrescar(eventId);
  return { error: null, mensaje: `${total} carril(es) recalculados.` };
}

export async function setEventVerifying(eventId: string): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();
  await supabase.from("events").update({ status: "verifying" }).eq("id", eventId);
  refrescar(eventId);
}
