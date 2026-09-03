import "server-only";

import { reduceLaneEvents } from "@/shared/timing/reducer";
import type { Segment, TimingEvent } from "@/shared/timing/types";
import { reduceWodEvents } from "@/shared/timing/wod";
import { armarEstructuraDeWod } from "@/shared/timing/wodStructure";
import { scoreFromLaneResult, scoreFromWodResult } from "@/shared/scoring/fromTiming";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Reconstruye el cache de resultados desde el log de marcajes.
 *
 * Corre `reduceLaneEvents`, LA MISMA funcion pura que usa el celular del juez
 * para pintar el tiempo en vivo. No hay una segunda implementacion del calculo
 * en SQL ni aca: si el tiempo en vivo y el oficial pudieran diferir, el producto
 * entero pierde sentido.
 *
 * `results` es cache: se puede borrar entera y reconstruirse. La unica fuente de
 * verdad es `timing_events`.
 *
 * Vive en un modulo compartido y no dentro de la ruta HTTP porque tambien lo
 * llama la torre de control. Un server action que le hiciera fetch a su propia
 * API no llevaria las cookies de sesion y recibiria un 401.
 */
export async function recomputeLanes(filtro: {
  laneId?: string;
  heatId?: string;
}): Promise<{ recalculados: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { recalculados: 0, error: "Sin sesion" };

  // Los carriles se resuelven con el cliente del USUARIO: RLS decide cuales
  // puede ver. Si no son de su organizacion no llega ninguna fila y no hay nada
  // que recalcular.
  const query = supabase.from("lanes").select("id, event_id, heat_id, team_id, workout_id");
  const { data: lanes } = filtro.laneId
    ? await query.eq("id", filtro.laneId)
    : filtro.heatId
      ? await query.eq("heat_id", filtro.heatId)
      : { data: null };

  if (!lanes || lanes.length === 0) return { recalculados: 0, error: "Sin carriles" };

  // `results` solo la escribe head judge u organizacion, pero el cache tiene que
  // actualizarse tambien cuando sincroniza un juez comun. Ya verificamos arriba
  // que el carril es suyo, asi que el service role escribe en su nombre sin
  // abrirle la tabla.
  const service = createServiceClient();
  let recalculados = 0;

  // La parte de circuito de cada prueba, cacheada: todos los carriles de un
  // mismo heat comparten la suya.
  const partePorPrueba = new Map<string, string | null>();
  async function parteDeCircuito(workoutId: string): Promise<string | null> {
    const cacheada = partePorPrueba.get(workoutId);
    if (cacheada !== undefined) return cacheada;
    const { data } = await service
      .from("workout_parts")
      .select("id")
      .eq("workout_id", workoutId)
      .eq("time_scheme", "circuito")
      .order("order_index")
      .limit(1)
      .maybeSingle();
    const id = data?.id ?? null;
    partePorPrueba.set(workoutId, id);
    return id;
  }

  for (const lane of lanes) {
    const [{ data: eventos }, { data: equipo }] = await Promise.all([
      service.from("timing_events").select("*").eq("lane_id", lane.id).order("seq"),
      lane.team_id
        ? service
            .from("teams")
            .select("division_id, divisions (course_template_id)")
            .eq("id", lane.team_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const info = equipo as {
      division_id: string;
      divisions: { course_template_id: string } | null;
    } | null;

    if (!info) continue;

    // Un carril de CrossFit no tiene circuito: sus marcajes se reducen con el
    // otro motor. Se resuelve primero para no quedar atrapado en el camino del
    // circuito.
    if (lane.workout_id) {
      recalculados += await recalcularWod({
        service,
        lane: {
          id: lane.id,
          eventId: lane.event_id,
          heatId: lane.heat_id,
          workoutId: lane.workout_id,
          teamId: lane.team_id,
        },
        divisionId: info.division_id,
        eventos: eventos ?? [],
      });
    }

    if (!info.divisions?.course_template_id) continue;

    const { data: segmentRows } = await service
      .from("segments")
      .select("id, order_index, kind, name")
      .eq("course_template_id", info.divisions.course_template_id)
      .order("order_index");

    const segments: Segment[] = (segmentRows ?? []).map((s) => ({
      id: s.id,
      orderIndex: s.order_index,
      kind: s.kind,
      name: s.name,
    }));

    const log: TimingEvent[] = (eventos ?? []).map((e) => ({
      id: e.id,
      laneId: e.lane_id,
      seq: e.seq,
      type: e.type,
      segmentId: e.segment_id,
      elapsedMs: e.elapsed_ms,
      payload: (e.payload ?? {}) as Record<string, unknown>,
      recordedBy: e.recorded_by,
      deviceId: e.device_id ?? "",
      clientCapturedAt: e.client_captured_at ? new Date(e.client_captured_at).getTime() : 0,
      supersedesId: e.supersedes_id,
      voided: e.voided,
      voidReason: e.void_reason,
    }));

    const resultado = reduceLaneEvents(lane.id, log, segments);

    await service.from("results").upsert(
      {
        lane_id: lane.id,
        event_id: lane.event_id,
        heat_id: lane.heat_id,
        team_id: lane.team_id,
        division_id: info.division_id,
        // El reductor dice "not_started"; el enum de la base lo llama "idle".
        status: resultado.status === "not_started" ? "idle" : resultado.status,
        raw_ms: resultado.rawMs,
        penalty_ms: resultado.penaltyMs,
        total_ms: resultado.totalMs,
        stopped_at_ms: resultado.stoppedAtMs,
        splits: resultado.splits,
        anomalies: resultado.anomalies,
        source_event_count: log.length,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lane_id" },
    );

    // LA COSTURA ENTRE LOS DOS MOTORES.
    //
    // El mismo LaneResult que acaba de producir `results` se convierte en un
    // score, para que el motor de puntuacion tenga UNA sola entrada venga de
    // donde venga: del cronometro o de la carga manual. La conversion vive en
    // scoreFromLaneResult y no aca, para que no existan dos.
    const parteId = lane.workout_id ? await parteDeCircuito(lane.workout_id) : null;

    if (parteId && lane.team_id) {
      const score = scoreFromLaneResult({
        partId: parteId,
        teamId: lane.team_id,
        lane: resultado,
      });

      await service.from("workout_scores").upsert(
        {
          part_id: parteId,
          team_id: lane.team_id,
          // El trigger de la base los vuelve a derivar; van igual porque son
          // columnas NOT NULL.
          event_id: lane.event_id,
          division_id: info.division_id,
          score_unit: "tiempo",
          status: score.status,
          value_num: score.value,
          tiebreak_value: score.tiebreak,
          source: "en_vivo",
          lane_id: lane.id,
        },
        { onConflict: "part_id,team_id" },
      );
    }

    recalculados += 1;
  }

  return { recalculados };
}

type FilaDeMarcaje = {
  id: string;
  lane_id: string;
  seq: number;
  type: TimingEvent["type"];
  segment_id: string | null;
  elapsed_ms: number;
  payload: unknown;
  recorded_by: string;
  device_id: string | null;
  client_captured_at: string | null;
  supersedes_id: string | null;
  voided: boolean;
  void_reason: string | null;
};

/** Fila de la base -> evento del dominio. */
function aTimingEvent(e: FilaDeMarcaje): TimingEvent {
  return {
    id: e.id,
    laneId: e.lane_id,
    seq: e.seq,
    type: e.type,
    segmentId: e.segment_id,
    elapsedMs: e.elapsed_ms,
    payload: (e.payload ?? {}) as Record<string, unknown>,
    recordedBy: e.recorded_by,
    deviceId: e.device_id ?? "",
    clientCapturedAt: e.client_captured_at ? new Date(e.client_captured_at).getTime() : 0,
    supersedesId: e.supersedes_id,
    voided: e.voided,
    voidReason: e.void_reason,
  };
}

/**
 * Reduce los marcajes de un carril de CrossFit y escribe sus scores.
 *
 * Corre `reduceWodEvents`, la misma funcion pura que la pantalla del juez usa
 * para pintar el contador. No hay una segunda implementacion del conteo: si el
 * numero que ve el juez y el oficial pudieran diferir, el producto pierde
 * sentido igual que si difirieran los tiempos.
 *
 * Devuelve cuantas partes recalculo.
 */
async function recalcularWod(params: {
  service: ReturnType<typeof createServiceClient>;
  lane: {
    id: string;
    eventId: string;
    heatId: string;
    workoutId: string;
    teamId: string | null;
  };
  divisionId: string;
  eventos: FilaDeMarcaje[];
}): Promise<number> {
  const { service, lane, divisionId, eventos } = params;
  if (!lane.teamId) return 0;

  const { data: partes } = await service
    .from("workout_parts")
    .select(
      "id, label, order_index, time_scheme, score_unit, time_cap_ms, window_ms, interval_ms",
    )
    .eq("workout_id", lane.workoutId)
    .neq("time_scheme", "circuito")
    // SOLO las que se capturan en vivo. Sin este filtro, una prueba de carga
    // manual sin marcajes reduciria a "pendiente" y pisaria el score que el
    // staff ya habia cargado a mano.
    .eq("capture_mode", "en_vivo")
    .order("order_index");

  if (!partes || partes.length === 0) return 0;

  const partIds = partes.map((p) => p.id);

  const [{ data: bloques }, { data: movimientos }, { data: heat }] = await Promise.all([
    service
      .from("part_blocks")
      .select("id, part_id, order_index, kind, repeticiones, duracion_ms, descanso_ms")
      .in("part_id", partIds),
    service
      .from("part_movements")
      .select(
        "id, block_id, part_id, order_index, movement_id, custom_name, unit, target_per_round, load_kg, max_reps, es_tiebreak",
      )
      .in("part_id", partIds),
    service.from("heats").select("started_at").eq("id", lane.heatId).maybeSingle(),
  ]);

  const movementIds = [
    ...new Set(
      (movimientos ?? []).map((m) => m.movement_id).filter((id): id is string => Boolean(id)),
    ),
  ];

  const [{ data: catalogo }, { data: specs }] = await Promise.all([
    movementIds.length > 0
      ? service.from("movements").select("id, name").in("id", movementIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    service
      .from("division_movement_specs")
      .select("part_movement_id, target_per_round, load_kg")
      .eq("division_id", divisionId),
  ]);

  const nombres = new Map((catalogo ?? []).map((m) => [m.id, m.name]));
  const specPorMovimiento = new Map((specs ?? []).map((sp) => [sp.part_movement_id, sp]));

  // Cuanto lleva corriendo el heat. Es lo que permite que un WOD capeado quede
  // capeado aunque nadie haya emitido el evento porque la app estaba en
  // segundo plano.
  const nowElapsedMs = heat?.started_at
    ? Math.max(0, Date.now() - new Date(heat.started_at).getTime())
    : undefined;

  const log = eventos.map(aTimingEvent);
  let recalculadas = 0;

  for (const parte of partes) {
    // Cada parte cuenta solo sus marcajes. La largada es una sola y vale para
    // todas.
    const suyos = log.filter(
      (e) => e.type === "lane_start" || e.payload?.partId === parte.id,
    );

    const structure = armarEstructuraDeWod({
      parte,
      bloques: bloques ?? [],
      movimientos: movimientos ?? [],
      nombres,
      specs: specPorMovimiento,
    });

    const resultado = reduceWodEvents(lane.id, suyos, structure, nowElapsedMs);
    const score = scoreFromWodResult({
      partId: parte.id,
      teamId: lane.teamId,
      wod: resultado,
      scoreUnit: parte.score_unit,
    });

    await service.from("workout_scores").upsert(
      {
        part_id: parte.id,
        team_id: lane.teamId,
        event_id: lane.eventId,
        division_id: divisionId,
        score_unit: parte.score_unit,
        status: score.status,
        value_num: score.value,
        value_reps: score.reps,
        value_cap: score.capValue,
        tiebreak_value: score.tiebreak,
        source: "en_vivo",
        lane_id: lane.id,
      },
      { onConflict: "part_id,team_id" },
    );

    recalculadas += 1;
  }

  return recalculadas;
}
