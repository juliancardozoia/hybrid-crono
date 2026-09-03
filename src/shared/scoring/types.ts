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
};

/** Una fila de la tabla general de una categoria. */
export type OverallEntry = {
  teamId: string;
  totalPoints: number;
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
