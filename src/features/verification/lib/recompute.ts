import "server-only";

import { reduceLaneEvents } from "@/shared/timing/reducer";
import type { Segment, TimingEvent } from "@/shared/timing/types";
import { reduceWodEvents } from "@/shared/timing/wod";
import {
  armarEstructuraDeWod,
  type EspecificacionDeCategoria,
  type FilaDeBloque,
  type FilaDeMovimiento,
  type FilaDeParte,
} from "@/shared/timing/wodStructure";
import { scoreFromLaneResult, scoreFromWodResult } from "@/shared/scoring/fromTiming";
import type { RoundBreakdownStep, ScoreStatus, ScoreUnit } from "@/shared/scoring/types";
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
      .select("id, order_index, kind, name, es_tiebreak")
      .eq("course_template_id", info.divisions.course_template_id)
      .order("order_index");

    const segments: Segment[] = (segmentRows ?? []).map((s) => ({
      id: s.id,
      orderIndex: s.order_index,
      kind: s.kind,
      name: s.name,
    }));

    // El segmento marcado como desempate de ESTA plantilla, si hay uno. Se
    // resuelve por division (via course_template_id) y no por evento: dos
    // circuitos independientes del mismo evento no se interfieren -- ver
    // marcar_segmento_de_desempate en la migracion.
    const tiebreakSegmentId = (segmentRows ?? []).find((s) => s.es_tiebreak)?.id ?? null;

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
        tiebreakSegmentId,
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

  // `heats.status` nunca llega a 'finished' en ningun lado del codigo: es el
  // hueco que impedia saber si un heat seguia en curso. `ended_at` lo llena
  // ACA, con el mismo recalculo que ya corre en cada sincronizacion, en vez
  // de agregar un tercer camino de escritura para lo mismo.
  const heatIds = [...new Set(lanes.map((l) => l.heat_id))];
  await Promise.all(heatIds.map((heatId) => actualizarCierreDeHeat(service, heatId)));

  return { recalculados };
}

const TERMINAL_CIRCUITO = new Set(["finished", "dnf", "dq"]);
const TERMINAL_WOD = new Set(["valido", "capeado", "dnf", "dq"]);

/**
 * Que carriles (de los que tienen equipo) llegaron a un estado terminal.
 *
 * Un carril nunca tiene las dos cosas a la vez: o corre un circuito (fila en
 * `results`) o corre un WOD (una o mas filas en `workout_scores`, una por
 * parte en vivo). Por eso alcanza con mirar cual de los dos mapas tiene algo
 * para ese carril.
 *
 * Pura y exportada para probarla sin tocar la base — es exactamente el punto
 * donde `actualizarCierreDeHeat` tenia el hueco: solo miraba `results`, asi
 * que un heat 100% CrossFit (ningun carril con circuito) nunca llegaba a
 * `ended_at`, sin importar cuanto tiempo llevaran todos sus carriles
 * terminados.
 */
export function carrilesTerminados(
  conAtleta: Array<{ laneId: string }>,
  estadoCircuitoPorCarril: Map<string, string>,
  estadosWodPorCarril: Map<string, string[]>,
): Set<string> {
  const terminados = new Set<string>();
  for (const lane of conAtleta) {
    const circuito = estadoCircuitoPorCarril.get(lane.laneId);
    if (circuito !== undefined) {
      if (TERMINAL_CIRCUITO.has(circuito)) terminados.add(lane.laneId);
      continue;
    }
    const wod = estadosWodPorCarril.get(lane.laneId);
    if (wod && wod.length > 0 && wod.every((estado) => TERMINAL_WOD.has(estado))) {
      terminados.add(lane.laneId);
    }
  }
  return terminados;
}

/**
 * Un heat "termino" cuando TODOS sus carriles con atleta llegaron a un
 * estado terminal. Se reevalua cada vez, en los dos sentidos: si ya estaba
 * marcado y un recalculo (p. ej. anular un marcaje) lo saca de terminal, se
 * destranca solo -- 'results'/'workout_scores' son cache y pueden cambiar,
 * `ended_at` tiene que seguirlos.
 *
 * De paso, todo carril INDIVIDUAL que llega a terminal libera a su juez del
 * lease de `claim_lane` -aunque el heat entero siga corriendo, porque otro
 * atleta del mismo heat puede seguir en carrera-. Sin esto, "un juez, un heat
 * a la vez" lo dejaba atado a ese heat hasta que el lease de 6 horas venciera
 * solo, y el UNICO camino para soltarlo antes era un boton manual en la
 * pantalla del juez ("Terminé - liberar este carril") que ademas seguia
 * ofreciendo carriles ya terminados para que otro los "tomara".
 */
async function actualizarCierreDeHeat(
  service: ReturnType<typeof createServiceClient>,
  heatId: string,
): Promise<void> {
  const [{ data: carriles }, { data: heat }] = await Promise.all([
    service.from("lanes").select("id, team_id, judge_id").eq("heat_id", heatId),
    service.from("heats").select("ended_at, started_at").eq("id", heatId).maybeSingle(),
  ]);

  if (!heat || !heat.started_at) return;

  const conAtleta = (carriles ?? []).filter((l) => l.team_id !== null);
  if (conAtleta.length === 0) return;

  const laneIds = conAtleta.map((l) => l.id);

  const [{ data: resultados }, { data: scores }] = await Promise.all([
    service.from("results").select("lane_id, status").in("lane_id", laneIds),
    service.from("workout_scores").select("lane_id, status").in("lane_id", laneIds),
  ]);

  const porCircuito = new Map((resultados ?? []).map((r) => [r.lane_id, r.status]));
  const porWod = new Map<string, string[]>();
  for (const s of scores ?? []) {
    // Un score manual (`source: 'manual'`) no tiene carril: no participa de
    // si ESTE carril esta terminado.
    if (!s.lane_id) continue;
    porWod.set(s.lane_id, [...(porWod.get(s.lane_id) ?? []), s.status]);
  }

  const terminados = carrilesTerminados(
    conAtleta.map((l) => ({ laneId: l.id })),
    porCircuito,
    porWod,
  );

  const completo = conAtleta.every((l) => terminados.has(l.id));

  if (completo && !heat.ended_at) {
    await service.from("heats").update({ ended_at: new Date().toISOString() }).eq("id", heatId);
  } else if (!completo && heat.ended_at) {
    await service.from("heats").update({ ended_at: null }).eq("id", heatId);
  }

  const paraLiberar = conAtleta.filter((l) => l.judge_id && terminados.has(l.id));
  if (paraLiberar.length > 0) {
    await service
      .from("lanes")
      .update({ lease_expires_at: new Date().toISOString() })
      .in(
        "id",
        paraLiberar.map((l) => l.id),
      );
  }
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
 * Que partes de esta prueba corre la categoria del carril, y con que cap.
 *
 * EXACTAMENTE la misma regla que aplica `armarPartesDeWod` en el bundle del
 * juez, y tiene que quedarse igual: si una filtra por `part_divisions` y la
 * otra no, el juez ve un WOD y el score oficial sale de otro. Es literalmente
 * el escenario que `wodStructure.ts` existe para evitar.
 *
 * Antes de esta funcion, la categoria no importaba: CUALQUIER carril de la
 * prueba se puntuaba con TODAS sus partes en vivo, corriera esa categoria o
 * no.
 *
 * Pura y exportada para poder probarla sin tocar la base: es exactamente el
 * punto donde ese hueco se filtraba.
 */
export function partesQueCorreLaCategoria(
  partes: FilaDeParte[],
  asignadas: Array<{ part_id: string; time_cap_ms: number | null }>,
): { suyas: FilaDeParte[]; capPorParte: Map<string, number | null> } {
  const capPorParte = new Map(asignadas.map((a) => [a.part_id, a.time_cap_ms]));
  return { suyas: partes.filter((p) => capPorParte.has(p.id)), capPorParte };
}

/** Una fila lista para `workout_scores.upsert()`. */
export interface ScoreDeWod {
  part_id: string;
  team_id: string;
  event_id: string;
  division_id: string;
  score_unit: ScoreUnit;
  status: ScoreStatus;
  value_num: number | null;
  value_reps: number | null;
  value_cap: number | null;
  tiebreak_value: number | null;
  /** Ver `RawScore.roundBreakdown`. Persistido para que el leaderboard pueda
   *  mostrar el mismo detalle que ve el juez, sin recalcular nada. */
  round_breakdown: RoundBreakdownStep[] | null;
  source: "en_vivo";
  lane_id: string;
}

/**
 * Reduce los marcajes de un carril de CrossFit a los scores de sus partes.
 *
 * Corre `reduceWodEvents`, la misma funcion pura que la pantalla del juez usa
 * para pintar el contador. No hay una segunda implementacion del conteo: si el
 * numero que ve el juez y el oficial pudieran diferir, el producto pierde
 * sentido igual que si difirieran los tiempos.
 *
 * PURA: recibe filas ya traidas de la base y devuelve los scores a escribir,
 * sin tocar Supabase. Es el puente real entre el log y el podio, y hasta esta
 * separacion no tenia un solo test — no por ser simple, sino porque vivia
 * mezclado con las diez consultas que lo alimentan.
 */
export function calcularScoresDeWod(params: {
  suyas: FilaDeParte[];
  capPorParte: Map<string, number | null>;
  bloques: FilaDeBloque[];
  movimientos: FilaDeMovimiento[];
  nombres: Map<string, string>;
  specs: Map<string, EspecificacionDeCategoria>;
  /** `Date.now() - heat.started_at`, o undefined si el heat no largo. */
  nowElapsedMs: number | undefined;
  eventos: TimingEvent[];
  laneId: string;
  teamId: string;
  eventId: string;
  divisionId: string;
}): ScoreDeWod[] {
  const {
    suyas,
    capPorParte,
    bloques,
    movimientos,
    nombres,
    specs,
    nowElapsedMs,
    eventos: log,
    laneId,
    teamId,
    eventId,
    divisionId,
  } = params;

  return suyas.map((parte): ScoreDeWod => {
    // Cada parte cuenta solo sus marcajes. La largada es una sola y vale para
    // todas.
    const suyos = log.filter(
      (e) => e.type === "lane_start" || e.payload?.partId === parte.id,
    );

    const structure = armarEstructuraDeWod({
      parte,
      bloques,
      movimientos,
      nombres,
      specs,
      capDeCategoriaMs: capPorParte.get(parte.id) ?? null,
    });

    // `FilaDeParte.score_unit` es `string` a proposito -- es un tipo puro y
    // desacoplado de la base, ver wodStructure.ts -- pero acA es siempre uno
    // de los valores del enum: lo puso `armarPartesDeWod()` leyendo la misma
    // columna que el CHECK de Postgres restringe.
    const scoreUnit = parte.score_unit as ScoreUnit;

    const resultado = reduceWodEvents(laneId, suyos, structure, nowElapsedMs);
    const score = scoreFromWodResult({ partId: parte.id, teamId, wod: resultado, scoreUnit });

    return {
      part_id: parte.id,
      team_id: teamId,
      event_id: eventId,
      division_id: divisionId,
      score_unit: scoreUnit,
      status: score.status,
      value_num: score.value,
      value_reps: score.reps,
      value_cap: score.capValue,
      tiebreak_value: score.tiebreak,
      round_breakdown: score.roundBreakdown,
      source: "en_vivo",
      lane_id: laneId,
    };
  });
}

/**
 * El wrapper de I/O: trae de la base todo lo que `calcularScoresDeWod`
 * necesita, y escribe lo que devuelve. La logica en si NO vive aca — vive en
 * las dos funciones puras de arriba, que es lo que las hace testeables sin
 * mockear Supabase.
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

  const { data: asignadas } = await service
    .from("part_divisions")
    .select("part_id, time_cap_ms")
    .eq("division_id", divisionId)
    .in(
      "part_id",
      partes.map((p) => p.id),
    );

  const { suyas, capPorParte } = partesQueCorreLaCategoria(partes, asignadas ?? []);
  if (suyas.length === 0) return 0;

  const partIds = suyas.map((p) => p.id);

  const [{ data: bloques }, { data: movimientos }, { data: heat }] = await Promise.all([
    service
      .from("part_blocks")
      .select("id, part_id, order_index, kind, repeticiones, duracion_ms, descanso_ms, cap_ms")
      .in("part_id", partIds),
    service
      .from("part_movements")
      .select(
        "id, block_id, part_id, order_index, movement_id, custom_name, unit, target_per_round, load_kg, load_unit, max_reps, es_tiebreak, capture_style, max_attempts",
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
      .select("part_movement_id, target_per_round, load_kg, load_unit")
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

  const scores = calcularScoresDeWod({
    suyas,
    capPorParte,
    bloques: bloques ?? [],
    movimientos: movimientos ?? [],
    nombres,
    specs: specPorMovimiento,
    nowElapsedMs,
    eventos: eventos.map(aTimingEvent),
    laneId: lane.id,
    teamId: lane.teamId,
    eventId: lane.eventId,
    divisionId,
  });

  for (const score of scores) {
    await service.from("workout_scores").upsert(score, { onConflict: "part_id,team_id" });
  }

  return scores.length;
}
