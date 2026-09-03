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
import type { WodStructure } from "@/shared/timing/wod";
import { armarEstructuraDeWod } from "@/shared/timing/wodStructure";
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
  /**
   * Las partes de CrossFit de esta prueba, con su estructura completa.
   *
   * Opcional a proposito: un bundle guardado antes de que existieran los WODs
   * no lo trae, y un juez con marcajes pendientes tiene que poder seguir
   * trabajando sin que la pantalla reviente. Si esta vacio o ausente, el carril
   * es un circuito y se cronometra con la pantalla de siempre.
   */
  wod?: ParteDeWod[];
  cachedAt: number;
}

export interface ParteDeWod {
  partId: string;
  label: string;
  orderIndex: number;
  /** Que mide la prueba. Decide cual de los numeros del reductor es el score. */
  scoreUnit: string;
  structure: WodStructure;
}

/**
 * `judge_lane_bundle()` reemplaza el `.from("lanes").select("... teams
 * (... athletes (...))")` que habia aca, por el mismo motivo que
 * `judge_visible_lanes()` en `queries.ts`: RLS es por fila, no por columna, y
 * abrir `athletes` por tabla para leer el nombre tambien hubiera abierto la
 * fecha de nacimiento y el documento de cualquier atleta de la competencia a
 * quien pidiera `select=*` por la API. La funcion arma el nombre adentro y
 * devuelve el string ya armado.
 */
interface LaneQueryRow {
  event_id: string;
  event_name: string | null;
  heat_id: string;
  heat_name: string;
  heat_started_at: string | null;
  lane_number: number;
  start_offset_ms: number;
  judge_id: string | null;
  workout_id: string;
  bib_number: number | null;
  team_name: string | null;
  athletes: string | null;
  division_id: string | null;
  division_name: string | null;
  course_template_id: string | null;
}

/**
 * Descarga el bundle desde Supabase. Requiere red.
 *
 * RLS ya limita el carril a los eventos del usuario, asi que un id ajeno
 * devuelve vacio sin necesidad de filtrar aca.
 */
export async function fetchLaneBundle(laneId: string): Promise<LaneBundle | null> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("judge_lane_bundle", { p_lane_id: laneId });

  if (error || !data || data.length === 0) return null;

  const row = data[0] as LaneQueryRow;
  const divisionId = row.division_id;

  // Un carril sin equipo no tiene division, y sin division no sabemos que
  // corre. No hay nada que cronometrar.
  if (!divisionId) return null;

  // Que se cronometra sale de la PRUEBA del carril, no de la division. Antes
  // salia de divisions.course_template_id, que ahora es solo el respaldo para
  // los eventos creados antes de que las pruebas existieran.
  const { data: partes } = await supabase
    .from("workout_parts")
    .select(
      "id, label, order_index, time_scheme, capture_mode, score_unit, time_cap_ms, window_ms, interval_ms",
    )
    .eq("workout_id", row.workout_id)
    .order("order_index");

  const circuito = (partes ?? []).find((p) => p.time_scheme === "circuito");

  const templateId = circuito
    ? ((
        await supabase
          .from("part_divisions")
          .select("course_template_id")
          .eq("part_id", circuito.id)
          .eq("division_id", divisionId)
          .maybeSingle()
      ).data?.course_template_id ?? row.course_template_id ?? null)
    : null;

  const [{ data: segmentRows }, { data: penaltyRows }] = await Promise.all([
    templateId
      ? supabase
          .from("segments")
          .select("id, order_index, kind, name")
          .eq("course_template_id", templateId)
          .order("order_index")
      : Promise.resolve({ data: [] as Array<{ id: string; order_index: number; kind: Segment["kind"]; name: string }> }),
    supabase
      .from("penalty_types")
      .select("code, label, kind, seconds")
      .eq("event_id", row.event_id)
      .eq("active", true)
      .order("code"),
  ]);

  // Al juez solo le bajan las partes que se juzgan en vivo. Una prueba de carga
  // manual no tiene nada que marcar: su resultado lo escribe el staff desde el
  // panel.
  const wod = await armarPartesDeWod(
    (partes ?? []).filter((p) => p.time_scheme !== "circuito" && p.capture_mode === "en_vivo"),
    divisionId,
  );

  return {
    laneId,
    eventId: row.event_id,
    eventName: row.event_name ?? "",
    heatId: row.heat_id,
    heatName: row.heat_name,
    heatStartedAt: row.heat_started_at,
    laneNumber: row.lane_number,
    startOffsetMs: row.start_offset_ms,
    bib: row.bib_number,
    athletes: row.athletes || row.team_name || "Sin atleta",
    divisionName: row.division_name ?? "",
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
    wod,
    cachedAt: Date.now(),
  };
}

interface ParteQueryRow {
  id: string;
  label: string;
  order_index: number;
  time_scheme: string;
  capture_mode: string;
  score_unit: string;
  time_cap_ms: number | null;
  window_ms: number | null;
  interval_ms: number | null;
}

/**
 * Baja bloques, movimientos y los pesos de la categoria, y los arma en la
 * estructura que come el reductor.
 *
 * Todo se resuelve aca, con señal, y queda en IndexedDB: la pantalla del juez
 * no vuelve a consultar nada. Un WOD de veinte movimientos con pesos por
 * categoria pesa unos pocos kilobytes.
 */
async function armarPartesDeWod(
  partes: ParteQueryRow[],
  divisionId: string,
): Promise<ParteDeWod[]> {
  if (partes.length === 0) return [];

  const supabase = createClient();
  const partIds = partes.map((p) => p.id);

  const [{ data: bloques }, { data: movimientos }] = await Promise.all([
    supabase
      .from("part_blocks")
      .select("id, part_id, order_index, kind, repeticiones, duracion_ms, descanso_ms")
      .in("part_id", partIds)
      .order("order_index"),
    supabase
      .from("part_movements")
      .select(
        "id, block_id, part_id, order_index, movement_id, custom_name, unit, target_per_round, load_kg, max_reps, es_tiebreak",
      )
      .in("part_id", partIds)
      .order("order_index"),
  ]);

  // Los nombres del catalogo y los pesos de la categoria, en dos consultas mas.
  const movementIds = [
    ...new Set((movimientos ?? []).map((m) => m.movement_id).filter((id): id is string => Boolean(id))),
  ];

  const [{ data: catalogo }, { data: specs }] = await Promise.all([
    movementIds.length > 0
      ? supabase.from("movements").select("id, name").in("id", movementIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    supabase
      .from("division_movement_specs")
      .select("part_movement_id, target_per_round, load_kg")
      .eq("division_id", divisionId),
  ]);

  const nombrePorId = new Map((catalogo ?? []).map((m) => [m.id, m.name]));
  const specPorMovimiento = new Map((specs ?? []).map((sp) => [sp.part_movement_id, sp]));

  return partes.map((parte): ParteDeWod => ({
    partId: parte.id,
    label: parte.label,
    orderIndex: parte.order_index,
    scoreUnit: parte.score_unit,
    structure: armarEstructuraDeWod({
      parte,
      bloques: bloques ?? [],
      movimientos: movimientos ?? [],
      nombres: nombrePorId,
      specs: specPorMovimiento,
    }),
  }));
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
