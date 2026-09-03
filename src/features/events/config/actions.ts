"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  GenderRule,
  PenaltyKind,
  SegmentKind,
} from "@/lib/supabase/types";
import {
  HYROX_STANDARD,
  PENALIZACIONES_DEMO,
} from "@/features/events/lib/courseTemplates";
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
  if (error.code === "23505")
    return "Ya existe un registro con ese nombre o código.";
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
    if (segError)
      return { error: "Se creó el circuito pero fallaron los segmentos." };
  }

  refrescar(eventId);
  return OK;
}

/**
 * Borra un circuito ENTERO.
 *
 * Solo tiene sentido si ninguna categoria lo esta usando: `divisions` tiene
 * `course_template_id` con `on delete restrict`, asi que Postgres ya lo
 * bloquearia solo. El chequeo de aca es para que el boton ni siquiera
 * aparezca cuando va a fallar — la pantalla no ofrece el boton si
 * `getDivisions` encuentra alguna categoria con este circuito.
 */
export async function deleteCourseTemplate(
  eventId: string,
  templateId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { data: enUso } = await supabase
    .from("divisions")
    .select("id")
    .eq("course_template_id", templateId)
    .limit(1);

  // El boton no deberia aparecer en este caso —la pantalla ya cuenta las
  // categorias que usan cada plantilla—, pero si de todos modos llega aca,
  // antes esto devolvia sin avisar nada.
  if (enUso && enUso.length > 0) {
    return {
      error: "Hay categorías usando este circuito: no se puede eliminar.",
    };
  }

  const { error } = await supabase
    .from("course_templates")
    .delete()
    .eq("id", templateId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function addSegment(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
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

export async function removeSegment(
  eventId: string,
  segmentId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { data: segmento } = await supabase
    .from("segments")
    .select("course_template_id")
    .eq("id", segmentId)
    .maybeSingle();

  const { error } = await supabase
    .from("segments")
    .delete()
    .eq("id", segmentId);
  if (error) return { error: traducir(error) };

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
  return OK;
}

export async function moveSegment(
  eventId: string,
  templateId: string,
  segmentId: string,
  direction: "up" | "down",
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { data: segmentos } = await supabase
    .from("segments")
    .select("id")
    .eq("course_template_id", templateId)
    .order("order_index");

  if (!segmentos) return OK;

  const ids = segmentos.map((s) => s.id);
  const desde = ids.indexOf(segmentId);
  const hasta = direction === "up" ? desde - 1 : desde + 1;

  // Ya esta en la punta: mover "arriba" el primero o "abajo" el ultimo no es
  // un error, es un limite normal que la UI deberia deshabilitar. Se responde
  // OK sin tocar nada en vez de fallar.
  if (desde === -1 || hasta < 0 || hasta >= ids.length) return OK;

  [ids[desde], ids[hasta]] = [ids[hasta], ids[desde]];

  // Se manda la lista completa: reorder_segments renumera todo de una, que es
  // la unica forma de no chocar con unique(course_template_id, order_index).
  const { error } = await supabase.rpc("reorder_segments", {
    p_template_id: templateId,
    p_ordered_ids: ids,
  });
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

// --- Divisiones -------------------------------------------------------------

export async function createDivision(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const courseTemplateId = String(formData.get("courseTemplateId") ?? "");
  const teamSize = Number(formData.get("teamSize") ?? 1);
  const genderRule = String(formData.get("genderRule") ?? "any") as GenderRule;
  const ageMin = formData.get("ageMin") ? Number(formData.get("ageMin")) : null;
  const ageMax = formData.get("ageMax") ? Number(formData.get("ageMax")) : null;
  const level = String(formData.get("level") ?? "").trim() || null;
  const scoringTableId =
    String(formData.get("scoringTableId") ?? "").trim() || null;
  const cupoBruto = String(formData.get("capacity") ?? "").trim();

  await requireManage(eventId);

  if (name.length < 2) return { error: "Escribe un nombre a la división." };
  // El circuito ya NO es obligatorio: una categoría de CrossFit no corre un
  // circuito, corre N pruebas. `divisions.course_template_id` se volvió nullable
  // justo para esto, y exigirlo aquí era lo único que quedaba del modelo viejo,
  // cuando la plataforma solo entendía de carreras híbridas.
  if (genderRule === "mixed" && teamSize < 2) {
    return { error: "Una división mixta necesita equipos de 2 o más." };
  }
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    return { error: "La edad mínima no puede ser mayor que la máxima." };
  }

  // Vacio = ilimitado, y por eso se guarda NULL y no cero: cero es un cupo real
  // —una categoria cerrada— y confundirlos dejaria fuera a todo el mundo sin que
  // nadie entienda por que.
  let capacity: number | null = null;
  if (cupoBruto) {
    const n = Number(cupoBruto);
    if (!Number.isInteger(n) || n < 1) {
      return {
        error: "El límite de registros es un número entero mayor que cero.",
      };
    }
    capacity = n;
  }

  const supabase = await createClient();
  const { data: creada, error } = await supabase
    .from("divisions")
    .insert({
      event_id: eventId,
      name,
      course_template_id: courseTemplateId || null,
      team_size: teamSize,
      gender_rule: genderRule,
      age_min: ageMin,
      age_max: ageMax,
      level,
      scoring_table_id: scoringTableId,
    })
    .select("id")
    .single();

  if (error || !creada) return { error: traducir(error) };

  // El cupo vive en `division_registration` y no en `divisions`: es un dato del
  // TRAMITE, no de la categoria — la categoria sigue existiendo cuando las
  // inscripciones cierran. Solo se crea la fila si hay algo que guardar.
  if (capacity !== null) {
    await supabase
      .from("division_registration")
      .upsert(
        { division_id: creada.id, event_id: eventId, capacity },
        { onConflict: "division_id" },
      );
  }

  refrescar(eventId);
  return OK;
}

export async function deleteDivision(
  eventId: string,
  divisionId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("divisions")
    .delete()
    .eq("id", divisionId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function saveSegmentSpec(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
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

export async function createPenaltyType(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");
  const label = String(formData.get("label") ?? "").trim();
  const kind = String(formData.get("kind") ?? "time_add") as PenaltyKind;
  const seconds =
    kind === "time_add" ? Number(formData.get("seconds") ?? 0) : 0;

  await requireManage(eventId);

  if (!/^[A-Z0-9_]{2,32}$/.test(code)) {
    return {
      error:
        "El código admite letras, números y guión bajo (2 a 32 caracteres).",
    };
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
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("penalty_types")
    .update({ active })
    .eq("id", penaltyId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function seedDefaultPenalties(
  eventId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = await supabase.from("penalty_types").insert(
    PENALIZACIONES_DEMO.map((p) => ({
      event_id: eventId,
      code: p.code,
      label: p.label,
      kind: p.kind,
      seconds: p.seconds,
    })),
  );
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

// --- Estado del evento ------------------------------------------------------

export async function setEventStatus(
  eventId: string,
  status: "draft" | "ready" | "live" | "verifying" | "published",
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({ status })
    .eq("id", eventId);
  // Antes el error de Postgres se descartaba sin mirarlo: un RLS que negara el
  // cambio, o un trigger de plan que lo bloqueara, no le llegaba a nadie — el
  // boton quedaba igual y el organizador no sabia por que.
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}
