"use server";

import { revalidatePath } from "next/cache";
import { requireEventAccess, requireManage } from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";
import { errorIncluye } from "@/shared/utils/matchError";

export interface FormState {
  error: string | null;
}

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
}

export async function createHeat(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const name = String(formData.get("name") ?? "").trim();
  const divisionId = String(formData.get("divisionId") ?? "") || null;
  const laneCount = Number(formData.get("laneCount") ?? 6);
  const scheduledAt = String(formData.get("scheduledAt") ?? "").trim() || null;

  if (name.length < 1) return { error: "Escribe un nombre al heat." };
  if (!Number.isInteger(laneCount) || laneCount < 1 || laneCount > 32) {
    return { error: "La cantidad de carriles tiene que estar entre 1 y 32." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("heats").insert({
    event_id: eventId,
    name,
    division_id: divisionId,
    lane_count: laneCount,
    scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "Ya hay un heat con ese nombre." : "No se pudo crear el heat.",
    };
  }

  refrescar(eventId);
  return { error: null };
}

/**
 * Reemplaza la asignacion completa de carriles.
 *
 * Va por assign_heat_lanes porque `unique (heat_id, lane_number)` y el indice
 * que impide que un equipo corra dos veces hacen que una carga fila por fila
 * pueda fallar a mitad y dejar el heat a medio armar.
 */
export async function assignLanes(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const heatId = String(formData.get("heatId") ?? "");
  await requireManage(eventId);

  // Los selectores vienen como lane-1, lane-2... La POSICION en el arreglo es el
  // numero de carril, asi que los huecos se mandan como null y NO se compactan:
  // filtrarlos hacia que un equipo puesto en el carril 3 terminara corriendo en
  // el 1.
  const equipos: Array<string | null> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("lane-")) continue;
    const index = Number(key.slice(5)) - 1;
    if (!Number.isInteger(index) || index < 0) continue;
    while (equipos.length <= index) equipos.push(null);
    equipos[index] = value ? String(value) : null;
  }

  const asignados = equipos.filter((t): t is string => Boolean(t));
  if (asignados.length === 0) {
    return { error: "Asigna al menos un equipo a un carril." };
  }
  if (new Set(asignados).size !== asignados.length) {
    return { error: "Hay un equipo repetido en dos carriles." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_heat_lanes", {
    p_heat_id: heatId,
    p_team_ids: equipos as string[],
  });

  if (error) {
    if (errorIncluye(error.message, "ya inicio", "ya largo")) {
      return { error: "El heat ya inició: no se pueden reasignar los carriles." };
    }
    // 23505: el indice que impide que un equipo corra dos veces en el evento.
    if (error.code === "23505") {
      return { error: "Uno de esos equipos ya está asignado a otro heat." };
    }
    if (errorIncluye(error.message, "ningun equipo")) {
      return { error: "Asigna al menos un equipo a un carril." };
    }
    if (errorIncluye(error.message, "carriles")) {
      return { error: "Hay más equipos que carriles en este heat." };
    }
    return { error: "No se pudieron asignar los carriles." };
  }

  refrescar(eventId);
  return { error: null };
}

/** Asigna (o quita) el juez de un carril. Pasa por transfer_lane, que audita. */
export async function setLaneJudge(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const laneId = String(formData.get("laneId") ?? "");
  const judgeId = String(formData.get("judgeId") ?? "") || null;

  const access = await requireEventAccess(eventId);
  if (!access.canVerify) {
    return { error: "Solo el juez principal o la organización pueden asignar carriles." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_lane", {
    p_lane_id: laneId,
    // El generador de tipos declara los argumentos de las funciones como no
    // nulos porque Postgres no expresa nullability en la firma. Pero pasar null
    // es justamente como se libera un carril, y transfer_lane lo contempla.
    p_to_judge: judgeId as string,
    p_reason: "Asignado desde el panel",
  });

  if (error) return { error: "No se pudo asignar el juez." };

  refrescar(eventId);
  return { error: null };
}

export async function deleteHeat(eventId: string, heatId: string): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();

  // Un heat que ya largo tiene marcajes colgando. Borrarlo destruiria tiempos
  // reales, asi que se bloquea acá y no solo en la UI.
  const { data: heat } = await supabase
    .from("heats")
    .select("started_at")
    .eq("id", heatId)
    .maybeSingle();

  if (heat?.started_at) return;

  await supabase.from("heats").delete().eq("id", heatId);
  refrescar(eventId);
}

export async function startHeat(eventId: string, heatId: string): Promise<void> {
  const access = await requireEventAccess(eventId);
  if (!access.canVerify) return;

  const supabase = await createClient();
  await supabase.rpc("start_heat", { p_heat_id: heatId });
  refrescar(eventId);
}

/**
 * Deshace una largada hecha por error.
 *
 * Solo funciona si no llego ningun marcaje: si un juez ya empezo a cronometrar,
 * deshacer la largada le borraria el ancla y sus parciales quedarian colgando de
 * un cero que ya no existe.
 */
export async function cancelHeatStart(eventId: string, heatId: string): Promise<void> {
  const access = await requireEventAccess(eventId);
  if (!access.canVerify) return;

  const supabase = await createClient();
  await supabase.rpc("cancel_heat_start", { p_heat_id: heatId });
  refrescar(eventId);
}
