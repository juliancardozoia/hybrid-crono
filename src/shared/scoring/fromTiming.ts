/**
 * El unico puente entre el motor de tiempos y el de puntuacion.
 *
 * Existe una sola conversion LaneResult -> RawScore en todo el proyecto, y esta
 * aca. La llama el recalculo del servidor al escribir el cache, y la puede
 * llamar la pantalla del juez para pintar la posicion en vivo. Si hubiera dos
 * implementaciones, el tiempo en vivo y el oficial podrian diferir, que es
 * exactamente lo que el producto no puede permitirse.
 */

import type { LaneResult, LaneStatus } from "../timing/types";
import type { WodResult } from "../timing/wod";
import type { RawScore, ScoreStatus, ScoreUnit } from "./types";

/**
 * El reductor de circuitos y el motor de puntuacion nombran distinto los mismos
 * estados. La traduccion vive en un solo lugar a proposito: ya hay una
 * asimetria parecida entre el reductor y el enum de Postgres ("not_started"
 * contra "idle"), y dispersar mapeos como ese es como se terminan divergiendo.
 */
const ESTADO_POR_LANE: Readonly<Record<LaneStatus, ScoreStatus>> = {
  finished: "valido",
  running: "en_curso",
  not_started: "pendiente",
  dnf: "dnf",
  dq: "dq",
};

export function scoreFromLaneResult(params: {
  partId: string;
  teamId: string;
  lane: LaneResult;
  /**
   * Segmento que define el desempate del circuito, si la prueba declara uno.
   * Se toma el acumulado al cerrarlo, que es la misma regla que usa CrossFit
   * para el tiebreak de un WOD capeado.
   */
  tiebreakSegmentId?: string | null;
}): RawScore {
  const { partId, teamId, lane, tiebreakSegmentId } = params;

  const tiebreak =
    tiebreakSegmentId != null
      ? (lane.splits.find((s) => s.segmentId === tiebreakSegmentId)?.cumulativeMs ?? null)
      : null;

  return {
    partId,
    teamId,
    status: ESTADO_POR_LANE[lane.status],
    // totalMs ya trae las penalizaciones sumadas, y ya es null salvo que el
    // carril haya terminado. No hay nada que recalcular aca.
    value: lane.totalMs,
    reps: null,
    // Un circuito no tiene cap: o termina o es DNF.
    capValue: null,
    tiebreak,
  };
}

/**
 * Convierte la salida del reductor de WODs en un score.
 *
 * Es la hermana de scoreFromLaneResult y cumple el mismo rol: que el motor de
 * puntuacion tenga UNA sola entrada, venga del cronometro de un circuito, del
 * cronometro de un WOD o de la carga manual.
 *
 * Que numero es "el score" depende de lo que la prueba mide, y eso lo sabe la
 * definicion de la parte, no el reductor. Por eso la unidad se pasa desde
 * afuera en vez de que el reductor la adivine.
 */
export function scoreFromWodResult(params: {
  partId: string;
  teamId: string;
  wod: WodResult;
  scoreUnit: ScoreUnit;
}): RawScore {
  const { partId, teamId, wod, scoreUnit } = params;

  const status: ScoreStatus = wod.capped
    ? "capeado"
    : ESTADO_POR_LANE[wod.status];

  // Solo un WOD terminado tiene marca. Uno capeado rankea por lo que alcanzo a
  // hacer, y eso viaja en capValue.
  const termino = status === "valido";

  let value: number | null = null;
  let reps: number | null = null;

  if (termino) {
    switch (scoreUnit) {
      case "tiempo":
        value = wod.finishedMs;
        break;
      case "rondas_reps":
        value = wod.completedRounds;
        reps = wod.repsInRound;
        break;
      case "rondas":
        value = wod.completedRounds;
        break;
      case "carga":
        value = wod.bestLiftKg;
        break;
      default:
        // reps, calorias, distancia y puntos se cuentan igual: unidades hechas.
        value = wod.completedReps;
        break;
    }
  }

  return {
    partId,
    teamId,
    status,
    value,
    reps,
    capValue: status === "capeado" ? wod.completedReps : null,
    tiebreak: wod.tiebreakMs,
  };
}
