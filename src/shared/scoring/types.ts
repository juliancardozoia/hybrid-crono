/**
 * Tipos del motor de puntuacion.
 *
 * Regla que gobierna todo este modulo: una prueba NO se elige de una lista de
 * formatos, se describe con dos datos independientes — la UNIDAD que mide y la
 * DIRECCION en que gana. Enumerar formatos es una carrera perdida: hay mas de
 * veinticinco estructuras de WOD en uso y cada temporada aparecen mas. Con
 * unidad + direccion, un Hyrox, un AMRAP, un Fight Gone Bad y una carga maxima
 * son configuraciones, no casos especiales del codigo.
 *
 * El otro invariante: nada de aca toca el DOM, la red ni Supabase. Es una
 * funcion pura de datos a datos, igual que src/shared/timing/, y por la misma
 * razon: corre identico en el cliente y en el servidor, asi que el leaderboard
 * en vivo y el oficial no pueden diferir.
 */

/** Que mide una prueba. El valor crudo siempre se guarda en esta unidad. */
export type ScoreUnit =
  /** Milisegundos. */
  | "tiempo"
  | "reps"
  | "rondas"
  /** Rondas completas + reps de la ronda parcial. Se comparan lexicograficamente. */
  | "rondas_reps"
  /** Kilos. */
  | "carga"
  /** Metros. */
  | "distancia"
  | "calorias"
  /** Puntaje directo cargado a mano. */
  | "puntos";

export type ScoreDir = "menor_gana" | "mayor_gana";

export type ScoreStatus =
  /** Todavia no se cargo ni se cronometro. Aparece en el padron igual. */
  | "pendiente"
  | "en_curso"
  | "valido"
  /** No termino dentro del cap. Rankea por la unidad del cap, siempre detras. */
  | "capeado"
  | "dnf"
  | "dq";

/**
 * La definicion de puntuacion de una parte. Es lo unico que el motor necesita
 * saber de una prueba: como se mide, hacia donde gana, y como se desempata.
 * La ESTRUCTURA (bloques, movimientos, rondas) no le incumbe: eso lo maneja la
 * pantalla del juez y el reductor de WODs.
 */
export type PartSpec = {
  id: string;
  orderIndex: number;
  scoreUnit: ScoreUnit;
  scoreDir: ScoreDir;
  /**
   * En que unidad se mide a quien capeo. Null si la prueba no tiene cap.
   * El cap siempre es "mayor gana" (mas reps es mejor) y no se configura:
   * un cap medido en "menos es mejor" no existe en ningun formato real.
   */
  capUnit: ScoreUnit | null;
  /** Desempate dentro de la prueba. Null si la prueba no lo declara. */
  tiebreakUnit: ScoreUnit | null;
  tiebreakDir: ScoreDir | null;
  /**
   * Si el desempate viene de OTRA parte ("el desempate de la final es el
   * tiempo de la clasificatoria"), el id de esa parte. Null en el resto de
   * los casos: ahi el valor ya esta en el `tiebreak` de la propia fila.
   *
   * Lo resuelve `resolverTiebreaksDeOtraPrueba`, ANTES de normalizar: una vez
   * adentro de `normalizeScore` solo se ve un score a la vez, y el dato que
   * hace falta esta en la fila de otra parte.
   */
  tiebreakPartId: string | null;
};

/**
 * Un movimiento de la ronda en la que el atleta quedo, con cuanto pedia y
 * cuanto se hizo de verdad. Mismo dato que `WodStepBreakdown` de
 * `shared/timing/wod.ts`, redeclarado aca (no importado) para no acoplar el
 * motor de puntuacion al de tiempos -- `fromTiming.ts` es el unico que conoce
 * a los dos y hace el traspaso.
 *
 * Es lo que permite mostrar "Pull-up completo · Push-up completo · Air
 * Squat 10 de 15" en vez de un total ambiguo como "3 rondas + 10 reps", que
 * no dice en cual de los movimientos de la ronda quedo ni si los anteriores
 * estan completos.
 */
export type RoundBreakdownStep = {
  name: string;
  unit: string;
  /** 0 si el movimiento es "las que pueda" (sin objetivo). */
  target: number;
  done: number;
  completo: boolean;
};

/**
 * El score crudo de un equipo en una parte, tal como se cargo a mano o como lo
 * derivo el reductor. Los cuatro numericos son excluyentes por status: se
 * separan en campos con nombre en vez de reusar uno solo porque un campo que
 * significa dos cosas segun el contexto es de donde salen los bugs de podio.
 */
export type RawScore = {
  partId: string;
  teamId: string;
  status: ScoreStatus;
  /** Valor principal, en `scoreUnit`. Null salvo que el status sea "valido". */
  value: number | null;
  /** Reps de la ronda parcial. Solo cuando `scoreUnit` es "rondas_reps". */
  reps: number | null;
  /** Valor en `capUnit`. Solo cuando el status es "capeado". */
  capValue: number | null;
  /** Valor del desempate, en `tiebreakUnit`. */
  tiebreak: number | null;
  /**
   * Desglose de la ronda en la que quedo, movimiento por movimiento. Null
   * cuando no aplica (no es un WOD por rondas, viene de carga manual sin
   * ese detalle, o el bloque cerro entero sin nada a medias).
   */
  roundBreakdown: RoundBreakdownStep[] | null;
};

/**
 * Valor comparable dentro de UNA parte.
 *
 * La direccion ya esta absorbida: `value` mayor SIEMPRE gana, mida la prueba
 * tiempo o repeticiones. Sin esta normalizacion cada consumidor tendria que
 * saber que unidad tenia su prueba, y alcanza con que uno se olvide para
 * invertir un podio entero.
 */
export type ComparableScore = {
  /** Menor gana. Ordena ANTES que `value`: separa terminado de capeado de DQ. */
  statusRank: number;
  /** Mayor gana. Null = incomparable (no cargado, DNF, DQ). */
  value: number | null;
  /** Mayor gana, ya normalizado. Null si la prueba no declara desempate. */
  tiebreak: number | null;
};

/**
 * Como se reparten los puntos de un GRUPO empatado.
 *
 * Dos convenciones legitimas y distintas, nunca una mezcla silenciosa:
 *
 * - `same_position_points`: cada empatado cobra los puntos INTEGROS de la
 *   posicion compartida. Es el reglamento oficial de los Games: "more than
 *   one athlete can share a workout rank, and each will earn the original
 *   point value". El puesto consumido (el 4 de un empate en el 3) no lo paga
 *   nadie, y el total repartido queda por ENCIMA de lo que ofrece la curva.
 * - `average_occupied_positions`: el grupo reparte equitativamente los puntos
 *   de TODAS las posiciones que ocupa -- (P3+P4)/2 para un empate en el 3.
 *   Es una CONVENCION SCORA, no el reglamento tradicional: conserva el total
 *   que reparte la curva, a costa de que un empate cerca del fondo ya no
 *   iguale exactamente los puntos del puesto compartido.
 *
 * El default es `same_position_points` porque es lo que el codigo siempre
 * hizo y lo que un organizador que viene de CrossFit espera al auditar la
 * tabla contra el reglamento oficial. La UI ofrece la otra rotulada como
 * convencion Scora, nunca como default.
 */
export type TiePointPolicy = "same_position_points" | "average_occupied_positions";

/**
 * Tabla de puntos por puesto.
 *
 * `points` vacio significa que los puntos SON la posicion (el sistema del
 * CrossFit Open, sin limite de participantes). Con valores, el indice 0 es el
 * primer puesto.
 */
export type ScoringTable = {
  id: string;
  name: string;
  points: readonly number[];
  /** Hacia donde gana la SUMA de puntos. Intrinseco a la tabla. */
  dir: ScoreDir;
  /** Como reparte los puntos un grupo empatado. Ver `TiePointPolicy`. */
  tiePolicy: TiePointPolicy;
};

/** El puesto de un equipo en una parte, con los puntos que le tocaron. */
export type PartPlacement = {
  partId: string;
  teamId: string;
  status: ScoreStatus;
  /** Posicion FISICA: competidores por delante + 1. Los empatados la comparten. */
  position: number;
  /** Cuantos comparten esta posicion. 1 = sin empate. */
  tiedWith: number;
  points: number;
  comparable: ComparableScore;
  /**
   * El valor CRUDO, sin normalizar (en la unidad de la parte). Sirve solo
   * para que una pantalla muestre "08:21" o "184 reps" en vez del puesto --
   * el ranking sale siempre de `comparable`, nunca de esto.
   */
  value: number | null;
  /** Reps de la ronda parcial. Solo tiene sentido si `scoreUnit` es "rondas_reps". */
  reps: number | null;
  /** Valor en `capUnit`. Solo si el status es "capeado". */
  capValue: number | null;
  /** Ver `RawScore.roundBreakdown`. */
  roundBreakdown: RoundBreakdownStep[] | null;
};

/** Una fila de la tabla general de una categoria. */
export type OverallEntry = {
  teamId: string;
  /** Precision completa (3 decimales). Es lo unico que se usa para ordenar y desempatar. */
  totalPoints: number;
  /**
   * `totalPoints` redondeado a entero, SOLO para mostrar. Nunca se usa para
   * comparar ni para sumar: la pantalla no puede mostrar "80.666 pts" pero el
   * motor tampoco puede perder precision por eso.
   */
  displayPoints: number;
  /** Una entrada por parte, en el orden del evento. */
  placements: PartPlacement[];
  /**
   * Las mismas posiciones, ORDENADAS ASCENDENTE. Es el desempate de los Games:
   * gana quien tenga el mejor puesto en el primer indice donde los vectores
   * difieren.
   */
  tiebreakVector: number[];
  position: number;
  tiedWith: number;
};

export type Placed<T> = {
  item: T;
  position: number;
  tiedWith: number;
};
