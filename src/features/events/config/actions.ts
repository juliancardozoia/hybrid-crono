"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { GenderRule, PenaltyKind, SegmentKind } from "@/lib/supabase/types";
import { HYROX_STANDARD, PENALIZACIONES_DEMO } from "@/features/events/lib/courseTemplates";
import { requireManage } from "@/features/events/lib/access";

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

/**
 * Traduce los errores de Postgres que el organizador puede provocar.
 * El resto se reporta generico: un mensaje de constraint no le sirve a nadie.
 */
function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo guardar.";
  if (error.code === "23505") return "Ya existe un registro con ese nombre o código.";
  if (error.code === "23503") return "Falta algo que este registro necesita.";
  if (error.code === "23514") return "Algún valor está fuera de rango.";
  if (error.code === "42501") return "No tienes permiso para esta operación.";
  return "No se pudo guardar.";
}

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
}

// --- Circuito ---------------------------------------------------------------

export async function createCourseTemplate(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const preset = String(formData.get("preset") ?? "vacio");

  await requireManage(eventId);
  if (name.length < 2) return { error: "Escribe un nombre al circuito." };

  const supabase = await createClient();
  const { data: template, error } = await supabase
    .from("course_templates")
    .insert({ event_id: eventId, name })
    .select("id")
    .single();

  if (error || !template) return { error: traducir(error) };

  // El preset de Hyrox ahorra cargar 16 segmentos a mano, que es lo que hace
  // que un organizador abandone la configuracion a mitad de camino.
  if (preset === "hyrox") {
    const { error: segError } = await supabase.from("segments").insert(
      HYROX_STANDARD.map((s) => ({
        course_template_id: template.id,
        event_id: eventId,
        order_index: s.orderIndex,
        kind: s.kind,
        name: s.name,
      })),
    );
    if (segError) return { error: "Se creó el circuito pero fallaron los segmentos." };
  }

  refrescar(eventId);
  return OK;
}

export async function addSegment(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "station") as SegmentKind;

  await requireManage(eventId);
  if (name.length < 2) return { error: "Escribe un nombre al segmento." };

  const supabase = await createClient();

  // El nuevo va al final. order_index es unique por plantilla, asi que se
  // calcula desde el maximo actual y no desde la cantidad de filas: si alguna
  // vez se borro un segmento del medio, contar filas produciria una colision.
  const { data: ultimo } = await supabase
    .from("segments")
    .select("order_index")
    .eq("course_template_id", templateId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("segments").insert({
    course_template_id: templateId,
    event_id: eventId,
    order_index: ultimo ? ultimo.order_index + 1 : 0,
    kind,
    name,
  });

  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function removeSegment(eventId: string, segmentId: string): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { data: segmento } = await supabase
    .from("segments")
    .select("course_template_id")
    .eq("id", segmentId)
    .maybeSingle();

  await supabase.from("segments").delete().eq("id", segmentId);

  // Borrar deja un hueco en order_index. No rompe nada (el reductor usa el
  // orden, no el numero), pero renumerar mantiene la lista ordenada y evita
  // sorpresas al reordenar despues.
  if (segmento) {
    const { data: restantes } = await supabase
      .from("segments")
      .select("id")
      .eq("course_template_id", segmento.course_template_id)
      .order("order_index");

    if (restantes && restantes.length > 0) {
      await supabase.rpc("reorder_segments", {
        p_template_id: segmento.course_template_id,
        p_ordered_ids: restantes.map((s) => s.id),
      });
    }
  }

  refrescar(eventId);
}

export async function moveSegment(
  eventId: string,
  templateId: string,
  segmentId: string,
  direction: "up" | "down",
): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { data: segmentos } = await supabase
    .from("segments")
    .select("id")
    .eq("course_template_id", templateId)
    .order("order_index");

  if (!segmentos) return;

  const ids = segmentos.map((s) => s.id);
  const desde = ids.indexOf(segmentId);
  const hasta = direction === "up" ? desde - 1 : desde + 1;

  if (desde === -1 || hasta < 0 || hasta >= ids.length) return;

  [ids[desde], ids[hasta]] = [ids[hasta], ids[desde]];

  // Se manda la lista completa: reorder_segments renumera todo de una, que es
  // la unica forma de no chocar con unique(course_template_id, order_index).
  await supabase.rpc("reorder_segments", {
    p_template_id: templateId,
    p_ordered_ids: ids,
  });

  refrescar(eventId);
}

// --- Divisiones -------------------------------------------------------------

export async function createDivision(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const courseTemplateId = String(formData.get("courseTemplateId") ?? "");
  const teamSize = Number(formData.get("teamSize") ?? 1);
  const genderRule = String(formData.get("genderRule") ?? "any") as GenderRule;
  const ageMin = formData.get("ageMin") ? Number(formData.get("ageMin")) : null;
  const ageMax = formData.get("ageMax") ? Number(formData.get("ageMax")) : null;
  const level = String(formData.get("level") ?? "").trim() || null;

  await requireManage(eventId);

  if (name.length < 2) return { error: "Escribe un nombre a la división." };
  if (!courseTemplateId) return { error: "Elige un circuito." };
  if (genderRule === "mixed" && teamSize < 2) {
    return { error: "Una división mixta necesita equipos de 2 o más." };
  }
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    return { error: "La edad mínima no puede ser mayor que la máxima." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("divisions").insert({
    event_id: eventId,
    name,
    course_template_id: courseTemplateId,
    team_size: teamSize,
    gender_rule: genderRule,
    age_min: ageMin,
    age_max: ageMax,
    level,
  });

  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function deleteDivision(eventId: string, divisionId: string): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();
  await supabase.from("divisions").delete().eq("id", divisionId);
  refrescar(eventId);
}

export async function saveSegmentSpec(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const divisionId = String(formData.get("divisionId") ?? "");
  const segmentId = String(formData.get("segmentId") ?? "");

  await requireManage(eventId);

  const numero = (campo: string): number | null => {
    const raw = formData.get(campo);
    if (raw === null || String(raw).trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const supabase = await createClient();
  const { error } = await supabase.from("division_segment_specs").upsert(
    {
      division_id: divisionId,
      segment_id: segmentId,
      event_id: eventId,
      target_reps: numero("targetReps"),
      load_kg: numero("loadKg"),
      distance_m: numero("distanceM"),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
    { onConflict: "division_id,segment_id" },
  );

  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

// --- Penalizaciones ---------------------------------------------------------

export async function createPenaltyType(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");
  const label = String(formData.get("label") ?? "").trim();
  const kind = String(formData.get("kind") ?? "time_add") as PenaltyKind;
  const seconds = kind === "time_add" ? Number(formData.get("seconds") ?? 0) : 0;

  await requireManage(eventId);

  if (!/^[A-Z0-9_]{2,32}$/.test(code)) {
    return { error: "El código admite letras, números y guión bajo (2 a 32 caracteres)." };
  }
  if (label.length < 2) return { error: "Escribe una descripción." };
  // La base tiene la misma regla; validar aca da un mensaje entendible en vez
  // de un error de constraint.
  if (kind === "time_add" && seconds <= 0) {
    return { error: "Una penalización de tiempo necesita más de 0 segundos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("penalty_types")
    .insert({ event_id: eventId, code, label, kind, seconds });

  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function togglePenaltyType(
  eventId: string,
  penaltyId: string,
  active: boolean,
): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();
  await supabase.from("penalty_types").update({ active }).eq("id", penaltyId);
  refrescar(eventId);
}

export async function seedDefaultPenalties(eventId: string): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();

  await supabase.from("penalty_types").insert(
    PENALIZACIONES_DEMO.map((p) => ({
      event_id: eventId,
      code: p.code,
      label: p.label,
      kind: p.kind,
      seconds: p.seconds,
    })),
  );

  refrescar(eventId);
}

// --- Estado del evento ------------------------------------------------------

export async function setEventStatus(
  eventId: string,
  status: "draft" | "ready" | "live" | "verifying" | "published",
): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();
  await supabase.from("events").update({ status }).eq("id", eventId);
  refrescar(eventId);
}
