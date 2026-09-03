/**
 * Posiciones fisicas y ranking de una prueba.
 *
 * "Posicion fisica" quiere decir: cantidad de competidores por delante + 1. Con
 * un triple empate en el tercer puesto, el siguiente queda 6 y no 4, porque
 * tiene cinco por delante. Es el criterio de los Games y aplica igual a la
 * tabla de una prueba y a la tabla general.
 */

import { compareComparable, normalizeScore, scorePendiente } from "./normalize";
import { pointsForPosition } from "./points";
import type {
  ComparableScore,
  PartPlacement,
  PartSpec,
  Placed,
  RawScore,
  ScoringTable,
} from "./types";

/**
 * Ordena y asigna posiciones fisicas.
 *
 * Es la unica implementacion de esta regla en todo el proyecto: la usan tanto
 * el ranking de una prueba como el de la tabla general. Si hubiera dos, tarde o
 * temprano una de las dos rompe el empate y la otra no.
 */
export function assignPhysicalPositions<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number,
): Placed<T>[] {
  const ordenados = [...items].sort(compare);
  const resultado: Placed<T>[] = [];

  let i = 0;
  while (i < ordenados.length) {
    // Avanza mientras los consecutivos empaten. El comparador es transitivo,
    // asi que comparar de a pares alcanza para cerrar el grupo entero.
    let fin = i;
    while (fin + 1 < ordenados.length && compare(ordenados[fin], ordenados[fin + 1]) === 0) {
      fin++;
    }

    const empatados = fin - i + 1;
    for (let k = i; k <= fin; k++) {
      resultado.push({ item: ordenados[k], position: i + 1, tiedWith: empatados });
    }

    i = fin + 1;
  }

  return resultado;
}

/**
 * Rankea una prueba y reparte los puntos.
 *
 * `teamIds` es el PADRON de la categoria, no la lista de los que tienen score:
 * un equipo sin marca aparece igual, en estado "pendiente" y al fondo. Sin eso
 * no se puede responder "a quien le falta cargar", que es justo la pantalla que
 * necesita la carga manual.
 *
 * Los empatados reciben todos los puntos de la posicion compartida, sin
 * promediar. Es lo que dice el reglamento de los Games: "more than one athlete
 * can share a workout rank, and each will earn the original point value".
 */
export function rankPart(params: {
  part: PartSpec;
  table: ScoringTable;
  teamIds: readonly string[];
  scores: readonly RawScore[];
}): PartPlacement[] {
  const { part, table, teamIds, scores } = params;

  const porEquipo = new Map<string, RawScore>();
  for (const score of scores) {
    if (score.partId !== part.id) continue;
    porEquipo.set(score.teamId, score);
  }

  const entradas = teamIds.map((teamId) => {
    const raw = porEquipo.get(teamId) ?? scorePendiente(part.id, teamId);
    return { teamId, status: raw.status, comparable: normalizeScore(part, raw) };
  });

  const ubicados = assignPhysicalPositions(entradas, (a, b) =>
    compareComparable(a.comparable, b.comparable),
  );

  return ubicados.map(({ item, position, tiedWith }) => ({
    partId: part.id,
    teamId: item.teamId,
    status: item.status,
    position,
    tiedWith,
    points: pointsForPosition(table, position),
    comparable: item.comparable satisfies ComparableScore,
  }));
}
