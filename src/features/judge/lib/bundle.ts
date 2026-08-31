/**
 * Todo lo que el juez necesita para cronometrar un carril, en un solo objeto.
 *
 * Se descarga una vez con señal y queda en IndexedDB. A partir de ahi la
 * pantalla del juez lee de local y no vuelve a depender de la red para nada
 * salvo sincronizar marcajes: el circuito, el catalogo de penalizaciones, el
 * dorsal y la largada del heat ya estan en el dispositivo.
 *
 * Es lo que hace que un juez pueda seguir trabajando aunque el wifi del venue
 * se caiga a mitad de la competencia.
 */

import { createClient } from "@/lib/supabase/client";
import type { PenaltyPayload, Segment } from "@/shared/timing/types";
import { getDb } from "./db";

export interface LaneBundle {
  laneId: string;
  eventId: string;
  eventName: string;
  heatId: string;
  heatName: string;
  /** Largada oficial del heat en ISO, o null si todavia no largo. */
  heatStartedAt: string | null;
  laneNumber: number;
  startOffsetMs: number;
  bib: number | null;
  athletes: string;
  divisionName: string;
  segments: Segment[];
  penalties: PenaltyPayload[];
  judgeId: string | null;
  cachedAt: number;
}

interface LaneQueryRow {
  id: string;
  event_id: string;
  lane_number: number;
  start_offset_ms: number;
  judge_id: string | null;
  // El nombre del evento viene anidado en heats: lanes no tiene FK directa a
  // events, solo compuestas hacia heats y teams.
  heats: {
    id: string;
    name: string;
    started_at: string | null;
    events: { name: string } | null;
  } | null;
  teams: {
    bib_number: number;
    name: string | null;
    divisions: { name: string; course_template_id: string } | null;
    team_members: Array<{ athletes: { first_name: string; last_name: string } | null }>;
  } | null;
}

/**
 * Descarga el bundle desde Supabase. Requiere red.
 *
 * RLS ya limita el carril a los eventos del usuario, asi que un id ajeno
 * devuelve vacio sin necesidad de filtrar aca.
 */
export async function fetchLaneBundle(laneId: string): Promise<LaneBundle | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("lanes")
    .select(
      `id, event_id, lane_number, start_offset_ms, judge_id,
       heats (id, name, started_at, events (name)),
       teams (
         bib_number, name,
         divisions (name, course_template_id),
         team_members (athletes (first_name, last_name))
       )`,
    )
    .eq("id", laneId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as LaneQueryRow;
  const templateId = row.teams?.divisions?.course_template_id;

  // Un carril sin equipo no tiene division, y sin division no sabemos que
  // circuito corre. No hay nada que cronometrar.
  if (!templateId || !row.heats) return null;

  const [{ data: segmentRows }, { data: penaltyRows }] = await Promise.all([
    supabase
      .from("segments")
      .select("id, order_index, kind, name")
      .eq("course_template_id", templateId)
      .order("order_index"),
    supabase
      .from("penalty_types")
      .select("code, label, kind, seconds")
      .eq("event_id", row.event_id)
      .eq("active", true)
      .order("code"),
  ]);

  const athletes =
    row.teams?.team_members
      .flatMap((m) => (m.athletes ? [`${m.athletes.first_name} ${m.athletes.last_name}`] : []))
      .join(" / ") ?? "";

  return {
    laneId: row.id,
    eventId: row.event_id,
    eventName: row.heats.events?.name ?? "",
    heatId: row.heats.id,
    heatName: row.heats.name,
    heatStartedAt: row.heats.started_at,
    laneNumber: row.lane_number,
    startOffsetMs: row.start_offset_ms,
    bib: row.teams?.bib_number ?? null,
    athletes: athletes || (row.teams?.name ?? "Sin atleta"),
    divisionName: row.teams?.divisions?.name ?? "",
    segments: (segmentRows ?? []).map((s) => ({
      id: s.id,
      orderIndex: s.order_index,
      kind: s.kind,
      name: s.name,
    })),
    penalties: (penaltyRows ?? []).map((p) => ({
      code: p.code,
      label: p.label,
      kind: p.kind,
      seconds: p.seconds,
    })),
    judgeId: row.judge_id,
    cachedAt: Date.now(),
  };
}

export async function saveBundle(bundle: LaneBundle): Promise<void> {
  await getDb().bundles.put(bundle);
}

export async function loadCachedBundle(laneId: string): Promise<LaneBundle | undefined> {
  return getDb().bundles.get(laneId);
}

/**
 * Devuelve el bundle priorizando la red, con el cache como red de contencion.
 *
 * El orden importa: si hay señal queremos la salida oficial del heat, que es
 * el dato que puede haber cambiado desde la ultima vez. Si no hay, seguimos con
 * lo que teniamos, que es infinitamente mejor que una pantalla en blanco.
 */
export async function resolveLaneBundle(
  laneId: string,
): Promise<{ bundle: LaneBundle | null; fromCache: boolean }> {
  const cached = await loadCachedBundle(laneId).catch(() => undefined);

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { bundle: cached ?? null, fromCache: true };
  }

  try {
    const fresco = await fetchLaneBundle(laneId);
    if (fresco) {
      await saveBundle(fresco);
      return { bundle: fresco, fromCache: false };
    }
  } catch {
    // Sin red o servidor caido: seguimos con el cache.
  }

  return { bundle: cached ?? null, fromCache: cached !== undefined };
}

/** Vuelve a consultar solo la largada del heat, para el estado de espera. */
export async function fetchHeatStart(heatId: string): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.from("heats").select("started_at").eq("id", heatId).maybeSingle();
  return data?.started_at ?? null;
}
