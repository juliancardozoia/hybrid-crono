/**
 * Posiciones fisicas y ranking de una prueba.
 *
 * "Posicion fisica" quiere decir: cantidad de competidores por delante + 1. Con
 * un triple empate en el tercer puesto, el siguiente queda 6 y no 4, porque
 * tiene cinco por delante. Es el criterio de los Games y aplica igual a la
 * tabla de una prueba y a la tabla general.
 */

import { compareComparable, normalizeScore, scorePendiente } from "./normalize";
import { pointsForTiedGroup } from "./points";
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
 * Como cobra un GRUPO empatado depende de `table.tiePolicy` (ver
 * `TiePointPolicy` en types.ts): con `same_position_points` -- el reglamento
 * oficial de los Games, "more than one athlete can share a workout rank, and
 * each will earn the original point value" -- todos cobran integros los
 * puntos de la posicion compartida. Con `average_occupied_positions` -- una
 * convencion de Scora, no del reglamento -- el grupo reparte equitativamente
 * los puntos de TODAS las posiciones que ocupa, para que un empate no infle
 * el total que reparte la curva. `pointsForTiedGroup` resuelve las dos.
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
    return { teamId, status: raw.status, comparable: normalizeScore(part, raw), raw };
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
    // Sin un valor real (pendiente, en_curso, dnf, dq) la posicion es solo el
    // lugar que ocupa en el padron mientras "falta cargar" — no una prueba
    // corrida. Puntuarla por la curva le daba puntos a un equipo que nunca
    // arranco el WOD, con el fieldSize completo empatado justo detras de los
    // pocos que si terminaron. La tabla de tiempo total ("points" vacio) usa
    // la posicion misma como valor a sumar -- ahi position=points es el
    // mecanismo de orden de una carrera, no un puntaje que se le muestre a
    // nadie, asi que sigue igual.
    points:
      item.comparable.value !== null || table.points.length === 0
        ? pointsForTiedGroup(table, position, tiedWith)
        : 0,
    comparable: item.comparable satisfies ComparableScore,
    // El valor CRUDO (en `scoreUnit`/`capUnit`, sin normalizar ni escalar):
    // lo que el motor usa para ordenar es `comparable`, esto es solo para
    // que una pantalla pueda mostrar "08:21" o "184 reps" en vez del puesto.
    value: item.raw.value,
    reps: item.raw.reps,
    capValue: item.raw.capValue,
  }));
}
