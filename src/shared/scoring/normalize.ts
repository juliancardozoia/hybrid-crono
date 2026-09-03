/**
 * Normalizacion: un score crudo -> un valor comparable donde mayor siempre gana.
 *
 * Es la pieza que hace que el resto del motor no tenga un `switch` por tipo de
 * prueba. Una vez normalizado, rankear un AMRAP y rankear un Hyrox es
 * literalmente el mismo codigo.
 */

import type {
  ComparableScore,
  PartSpec,
  RawScore,
  ScoreDir,
  ScoreStatus,
  ScoreUnit,
} from "./types";

/**
 * Kilos y metros se comparan como enteros escalados, nunca como floats.
 *
 * `102.5 === 102.5` puede dar false despues de aritmetica de punto flotante, y
 * un empate mal detectado no afecta a dos filas: corre TODAS las posiciones de
 * abajo y le cambia los puntos a media categoria.
 */
export const ESCALA_DECIMAL = 100;

/**
 * Codifica (rondas, reps) en un solo entero para que el orden lexicografico
 * salga de una resta. Muy por encima de cualquier AMRAP real: el record de reps
 * en una ronda no llega ni a cuatro digitos.
 */
export const ESCALA_RONDAS = 1_000_000;

/**
 * Menor gana. Ordena antes que el valor, y eso es lo que hace funcionar el cap
 * sin ninguna constante magica: un capeado nunca le gana a un finalizador
 * porque su statusRank ya lo puso detras, sin importar cuantas reps hizo.
 *
 * El orden relativo de los estados que tambien existen en el reductor de
 * circuitos es el mismo que usa `rankResults` en src/shared/timing/, para que
 * Hyrox produzca el mismo podio por los dos caminos.
 */
export const STATUS_RANK: Readonly<Record<ScoreStatus, number>> = {
  valido: 0,
  capeado: 1,
  en_curso: 2,
  pendiente: 3,
  dnf: 4,
  dq: 5,
};

function signo(dir: ScoreDir): number {
  return dir === "menor_gana" ? -1 : 1;
}

/**
 * Lleva un valor a un entero comparable en su unidad, sin aplicar direccion.
 * `reps` solo se usa en "rondas_reps"; en el resto se ignora.
 */
export function escalar(unit: ScoreUnit, value: number, reps: number | null): number {
  switch (unit) {
    case "tiempo":
    case "reps":
    case "rondas":
    case "calorias":
      return Math.round(value);
    case "carga":
    case "distancia":
    case "puntos":
      return Math.round(value * ESCALA_DECIMAL);
    case "rondas_reps":
      return Math.round(value) * ESCALA_RONDAS + Math.round(reps ?? 0);
  }
}

export function normalizeScore(part: PartSpec, raw: RawScore): ComparableScore {
  const statusRank = STATUS_RANK[raw.status];

  let value: number | null = null;

  if (raw.status === "valido" && raw.value !== null) {
    value = signo(part.scoreDir) * escalar(part.scoreUnit, raw.value, raw.reps);
  } else if (raw.status === "capeado" && raw.capValue !== null) {
    // Entre capeados gana el que mas hizo. No hace falta reconciliar esta
    // escala con la del valor principal: el statusRank ya los separo.
    value = escalar(part.capUnit ?? "reps", raw.capValue, null);
  }
  // en_curso, pendiente, dnf y dq quedan en null a proposito: son
  // incomparables entre si, asi que empatan y comparten posicion. Es lo que
  // manda el reglamento — los empates dentro de una prueba no se rompen.

  const tiebreak =
    part.tiebreakUnit !== null && part.tiebreakDir !== null && raw.tiebreak !== null
      ? signo(part.tiebreakDir) * escalar(part.tiebreakUnit, raw.tiebreak, null)
      : null;

  return { statusRank, value, tiebreak };
}

function compararDesempate(a: ComparableScore, b: ComparableScore): number {
  if (a.tiebreak === null && b.tiebreak === null) return 0;
  // Quien no declaro desempate queda detras de quien si lo tiene.
  if (a.tiebreak === null) return 1;
  if (b.tiebreak === null) return -1;
  return b.tiebreak - a.tiebreak;
}

/**
 * Orden dentro de una prueba: estado, luego valor (mayor gana), luego
 * desempate. Devuelve 0 solo cuando el empate es real, y ese 0 es lo que hace
 * que los empatados compartan posicion y cobren los mismos puntos.
 */
export function compareComparable(a: ComparableScore, b: ComparableScore): number {
  if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
  if (a.value === null && b.value === null) return compararDesempate(a, b);
  if (a.value === null) return 1;
  if (b.value === null) return -1;
  if (a.value !== b.value) return b.value - a.value;
  return compararDesempate(a, b);
}

/** Un score vacio para un equipo del padron que todavia no tiene marca. */
export function scorePendiente(partId: string, teamId: string): RawScore {
  return {
    partId,
    teamId,
    status: "pendiente",
    value: null,
    reps: null,
    capValue: null,
    tiebreak: null,
  };
}
