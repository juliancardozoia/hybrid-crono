"use server";

import { revalidatePath } from "next/cache";
import {
  requireEventAccess,
  requireManage,
} from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";
import type { HeatInsert, HeatInsertConTrigger } from "@/lib/supabase/types";
import { errorIncluye } from "@/shared/utils/matchError";
import { recomputeLanes } from "@/features/verification/lib/recompute";

export interface FormState {
  error: string | null;
}

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
}

/**
 * Crea un heat vacío para una categoría.
 *
 * SIN NOMBRE NI HORA DE LARGADA: se preguntaban al crear y no aportaban nada
 * —la hora real la pone `/cronograma`, y el nombre siempre terminaba siendo
 * "Heat 1", "Heat 2"...—. El nombre se genera solo, consecutivo POR
 * CATEGORÍA: "Individual Masculino" tiene su Heat 1, 2, 3 y "Individual
 * Femenino" tiene los suyos, sin chocar entre sí (`unique (event_id,
 * division_id, name)`, no `unique (event_id, name)` como antes).
 *
 * LA DIVISIÓN ES OBLIGATORIA. La opción "Mixto — varias divisiones" que
 * había acá se sacó: mezclar categorías en un mismo heat es exactamente lo
 * que impide numerar consecutivo por categoría, y en la práctica nadie la
 * usaba a propósito — un heat sin categoría es indistinguible de un olvido.
 */
export async function createHeat(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const divisionId = String(formData.get("divisionId") ?? "").trim();
  const laneCount = Number(formData.get("laneCount") ?? 6);

  if (!divisionId) return { error: "Elige una categoría." };
  if (!Number.isInteger(laneCount) || laneCount < 1 || laneCount > 32) {
    return { error: "La cantidad de carriles tiene que estar entre 1 y 32." };
  }

  const supabase = await createClient();
  const name = await siguienteNombreDeHeat(supabase, eventId, divisionId);

  const nuevo: HeatInsert = {
    event_id: eventId,
    name,
    division_id: divisionId,
    lane_count: laneCount,
    scheduled_at: null,
  };

  // El cast es por `workout_id`: la columna es NOT NULL pero la llena un trigger
  // antes del insert. Ver `HeatInsert` en lib/supabase/types.ts.
  const { error } = await supabase
    .from("heats")
    .insert(nuevo as HeatInsertConTrigger);

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Ya hay un heat con ese nombre en esta categoría."
          : "No se pudo crear el heat.",
    };
  }

  refrescar(eventId);
  return { error: null };
}

/**
 * "Heat N", con N = el mayor consecutivo ya usado en esta categoría + 1.
 *
 * Por el MAYOR y no por la CANTIDAD: si se borró el Heat 2 y quedan Heat 1 y
 * Heat 3, la cantidad da 2 y "Heat 2" chocaría con el que ya existe. El
 * mayor existente + 1 nunca choca, aunque deje huecos en la numeración.
 */
async function siguienteNombreDeHeat(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  divisionId: string,
): Promise<string> {
  const { data } = await supabase
    .from("heats")
    .select("name")
    .eq("event_id", eventId)
    .eq("division_id", divisionId);

  const maximo = (data ?? []).reduce((max, h) => {
    const m = /^Heat (\d+)$/.exec(h.name);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);

  return `Heat ${maximo + 1}`;
}

export interface EstadoDistribucion extends FormState {
  resumen?: string | null;
}

/**
 * Reparte de una todos los equipos confirmados de todas las categorías en
 * heats numerados, con jueces al azar.
 *
 * Es para el caso de 80 atletas o más: armar heats de a uno y asignar cada
 * juez a mano es tedioso, y elegir a mano quién juzga a quién es justo el
 * lugar donde alguien podría acomodar el resultado. Toda la lógica —el
 * recalculo si se corre dos veces, el sorteo de jueces, la numeración por
 * categoría— vive en `auto_distribuir_heats()`, para que esta acción sea
 * solo la puerta de entrada y la traducción del error.
 *
 * TODAVÍA SIN GATE DE PLAN A PROPÓSITO. Esto es candidato a plan Pro más
 * adelante (ver `src/features/planes/lib/errores.ts`), pero por ahora queda
 * habilitado para cualquier organización.
 */
export async function autoDistribuirHeats(
  _prev: EstadoDistribucion,
  formData: FormData,
): Promise<EstadoDistribucion> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const lanesPorHeat = Number(formData.get("lanesPorHeat") ?? 0);
  if (!Number.isInteger(lanesPorHeat) || lanesPorHeat < 1 || lanesPorHeat > 32) {
    return { error: "La cantidad de carriles por heat tiene que estar entre 1 y 32." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("auto_distribuir_heats", {
    p_event_id: eventId,
    p_lanes_por_heat: lanesPorHeat,
  });

  if (error) {
    return { error: "No se pudo distribuir los heats." };
  }

  const filas = data ?? [];
  if (filas.length === 0) {
    return {
      error: null,
      resumen: "No había equipos confirmados sin asignar en ninguna categoría.",
    };
  }

  const totalHeats = filas.reduce((n, f) => n + f.heats_creados, 0);
  const totalEquipos = filas.reduce((n, f) => n + f.equipos_asignados, 0);

  refrescar(eventId);
  return {
    error: null,
    resumen: `${totalHeats} heat(s) en ${filas.length} categoría(s), ${totalEquipos} equipo(s) distribuidos.`,
  };
}

/**
 * Reemplaza la asignacion completa de carriles.
 *
 * Va por assign_heat_lanes porque `unique (heat_id, lane_number)` y el indice
 * que impide que un equipo corra dos veces hacen que una carga fila por fila
 * pueda fallar a mitad y dejar el heat a medio armar.
 */
export async function assignLanes(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
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
      return {
        error: "El heat ya inició: no se pueden reasignar los carriles.",
      };
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
export async function setLaneJudge(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const laneId = String(formData.get("laneId") ?? "");
  const judgeId = String(formData.get("judgeId") ?? "") || null;

  const access = await requireEventAccess(eventId);
  if (!access.canVerify) {
    return {
      error:
        "Solo el juez principal o la organización pueden asignar carriles.",
    };
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

export async function deleteHeat(
  eventId: string,
  heatId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  // Un heat que ya largo tiene marcajes colgando. Borrarlo destruiria tiempos
  // reales, asi que se bloquea aquí y no solo en la UI.
  const { data: heat } = await supabase
    .from("heats")
    .select("started_at")
    .eq("id", heatId)
    .maybeSingle();

  // Antes esto devolvia sin avisar nada: tocar "Eliminar" en un heat ya
  // largado no hacia absolutamente nada visible, y nadie entendia por que.
  if (heat?.started_at)
    return { error: "Este heat ya inició: no se puede eliminar." };

  const { error } = await supabase.from("heats").delete().eq("id", heatId);
  if (error) return { error: "No se pudo eliminar el heat." };

  refrescar(eventId);
  return { error: null };
}

/**
 * Marca un carril como DNF desde el panel.
 *
 * Es para el atleta que no se presento: el reloj del heat le sigue corriendo
 * a un carril sin nadie marcando nada, y sin esto no habia forma de cerrarlo
 * salvo que el juez lo hiciera desde su celular — y puede no haber juez
 * prestando atencion a un carril vacio.
 *
 * Pasa por EL MISMO camino que el boton DNF del juez: un timing_event mas en
 * el log, via `ingest_timing_events`. No hay una segunda forma de marcar DNF
 * — si la hubiera, el juez y el panel podrian terminar en desacuerdo sobre
 * si un atleta corrio o no.
 */
export async function marcarDnf(eventId: string, laneId: string): Promise<FormState> {
  const access = await requireEventAccess(eventId);
  if (!access.canVerify) return { error: "No tienes permiso para esto." };

  const supabase = await createClient();
  const { data: lane } = await supabase
    .from("lanes")
    .select("heats (started_at)")
    .eq("id", laneId)
    .maybeSingle();

  const heat = (lane as { heats: { started_at: string | null } | null } | null)?.heats;
  const elapsedMs = heat?.started_at
    ? Math.max(0, Date.now() - new Date(heat.started_at).getTime())
    : 0;

  const { error } = await supabase.rpc("ingest_timing_events", {
    p_events: [
      {
        id: crypto.randomUUID(),
        laneId,
        // Un numero fijo bien alto: ningun circuito real tiene un millon de
        // segmentos, asi que el DNF siempre queda ordenado despues de
        // cualquier marcaje real que ese carril ya tuviera.
        seq: 1_000_000,
        type: "dnf",
        elapsedMs,
        segmentId: null,
        payload: {},
        deviceId: "panel-organizador",
        clientCapturedAt: Date.now(),
        supersedesId: null,
      },
    ],
  });

  if (error) return { error: "No se pudo marcar el DNF." };

  await recomputeLanes({ laneId });
  refrescar(eventId);
  return { error: null };
}

export async function startHeat(
  eventId: string,
  heatId: string,
): Promise<FormState> {
  const access = await requireEventAccess(eventId);
  if (!access.canVerify)
    return { error: "No tienes permiso para largar heats." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("start_heat", { p_heat_id: heatId });
  if (error) return { error: error.message || "No se pudo largar el heat." };

  refrescar(eventId);
  return { error: null };
}

/**
 * Deshace una largada hecha por error.
 *
 * Solo funciona si no llego ningun marcaje: si un juez ya empezo a cronometrar,
 * deshacer la largada le borraria el ancla y sus parciales quedarian colgando de
 * un cero que ya no existe.
 */
export async function cancelHeatStart(
  eventId: string,
  heatId: string,
): Promise<FormState> {
  const access = await requireEventAccess(eventId);
  if (!access.canVerify) return { error: "No tienes permiso para esto." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_heat_start", {
    p_heat_id: heatId,
  });
  if (error)
    return { error: error.message || "No se pudo deshacer la largada." };

  refrescar(eventId);
  return { error: null };
}
