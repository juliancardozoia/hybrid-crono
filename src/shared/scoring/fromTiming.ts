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
import type { MovementUnit, WodResult } from "../timing/wod";
import type { RawScore, ScoreStatus, ScoreUnit } from "./types";

/**
 * Que unidad de MOVIMIENTO corresponde a cada unidad de SCORE.
 *
 * Existe porque `wod.completedReps` suma TODOS los movimientos sin importar
 * su unidad -correcto para un chipper donde todos son `reps`, pero sin
 * sentido si el WOD mezcla, por ejemplo, "10 devil press" (reps, objetivo
 * fijo) con "max cal bike" (calorias, sin objetivo): sumarlas daria un
 * numero que no es ni reps ni calorias.
 *
 * `"puntos"` no tiene equivalente: es para carga manual, no para un WOD que
 * el reductor mide. Se queda sin entrada a proposito, y el llamador cae al
 * total sin discriminar.
 */
const UNIDAD_DE_SCORE: Partial<Record<ScoreUnit, MovementUnit>> = {
  reps: "reps",
  calorias: "calorias",
  distancia: "metros",
};

/**
 * El valor "de verdad" para una unidad de score que no es tiempo/rondas/carga.
 *
 * Si el WOD tiene un solo tipo de movimiento (el caso normal: un chipper
 * donde todo es `reps`), esto es exactamente `wod.completedReps` -mismo
 * numero, cero cambio de comportamiento. Solo difiere cuando el WOD mezcla
 * unidades, que es justo el caso que sumar todo junto rompe.
 */
function valorParaUnidadDeScore(wod: WodResult, scoreUnit: ScoreUnit): number {
  const unidadMovimiento = UNIDAD_DE_SCORE[scoreUnit];
  if (unidadMovimiento === undefined) return wod.completedReps;
  return wod.completedByUnit[unidadMovimiento] ?? wod.completedReps;
}

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
    // Un circuito no tiene rondas ni movimientos: eso es de un WOD.
    roundBreakdown: null,
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

  // `wod.capped` por si solo NO alcanza: con bloques + descanso puede
  // prenderse a mitad de la prueba, mientras el atleta todavia tiene el
  // descanso y el bloque siguiente por delante. Escribir "capeado" ahi -un
  // estado TERMINAL- cierra el HEAT ENTERO (`actualizarCierreDeHeat`) y le
  // vence el lease al juez antes de que termine de verdad. `sinNadaMasQueMarcar`
  // es la señal correcta de "no hay nada mas", calculada distinto en cada
  // reductor -ver el comentario en `WodResult`-.
  const status: ScoreStatus =
    wod.sinNadaMasQueMarcar && wod.capped ? "capeado" : ESTADO_POR_LANE[wod.status];

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
        // reps, calorias, distancia y puntos se cuentan igual: unidades
        // hechas EN LA UNIDAD QUE LA PRUEBA PUNTUA (ver `valorParaUnidadDeScore`).
        value = valorParaUnidadDeScore(wod, scoreUnit);
        break;
    }
  }

  // El desglose es "en que ronda quedo, movimiento por movimiento": solo
  // tiene sentido para una prueba que se puntua por rondas. Una carga maxima
  // (`carga`) no tiene rondas, tiene INTENTOS -- `contarRondas` igual devuelve
  // un desglose (arrastra el conteo de intentos como si fueran rondas, por
  // eso se veia "Ronda 121" con un intento de un WOD de peso), y mostrarlo ahi
  // es puro ruido: lo que importa de una carga maxima es `value` (el mejor
  // intento valido), no un desglose de "rondas".
  const rankeaPorRondas = scoreUnit === "rondas_reps" || scoreUnit === "rondas";

  return {
    partId,
    teamId,
    status,
    value,
    reps,
    capValue: status === "capeado" ? wod.completedReps : null,
    tiebreak: wod.tiebreakMs,
    // Vacio cuando el bloque cerro entero sin nada a medias -ahi "completedRounds"
    // ya describe el resultado sin ambiguedad-, o cuando la prueba no tiene rondas.
    roundBreakdown:
      rankeaPorRondas && wod.currentRoundBreakdown.length > 0 ? wod.currentRoundBreakdown : null,
  };
}
