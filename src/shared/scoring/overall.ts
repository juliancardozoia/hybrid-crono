/**
 * La tabla general de una categoria: suma de puntos y desempate por puestos.
 */

import { assignPhysicalPositions, rankPart } from "./place";
import { pointsDirection } from "./points";
import type {
  OverallEntry,
  PartPlacement,
  PartSpec,
  RawScore,
  ScoringTable,
} from "./types";

/**
 * Desempate de los Games: se comparan los vectores de posiciones ordenados
 * ascendente, elemento a elemento, y gana el primero que tenga un puesto mejor.
 * Dicho en criollo: entre dos que sumaron lo mismo, gana el que tuvo mejores
 * podios.
 *
 * Devuelve 0 solo si los vectores son identicos. Ahi el empate es real y los
 * dos comparten posicion: no se inventa un tercer criterio, porque el
 * reglamento no lo tiene y cualquiera que inventaramos seria arbitrario.
 */
export function compareTiebreakVectors(
  a: readonly number[],
  b: readonly number[],
): number {
  const comunes = Math.min(a.length, b.length);
  for (let i = 0; i < comunes; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  // Longitudes distintas solo pasa si dos equipos de la misma categoria
  // corrieron distinta cantidad de pruebas, que es un error de configuracion.
  // Se ordena de forma determinista en vez de dejarlo al azar del sort.
  return a.length - b.length;
}

/**
 * Calcula la tabla general de UNA categoria.
 *
 * `tableFor` resuelve la tabla de puntos de cada parte, para soportar la
 * jerarquia evento -> categoria -> prueba (una final con menos competidores
 * puede repartir distinto).
 *
 * La direccion de la suma sale de la tabla de la primera parte. Mezclar
 * direcciones entre partes de una misma categoria es una configuracion
 * incoherente que la UI tiene que impedir: aca no hay forma de resolverla y
 * elegir en silencio la de una parte cualquiera seria peor que ser predecible.
 */
export function computeOverall(params: {
  parts: readonly PartSpec[];
  tableFor: (part: PartSpec) => ScoringTable;
  teamIds: readonly string[];
  scores: readonly RawScore[];
}): OverallEntry[] {
  const { parts, tableFor, teamIds, scores } = params;

  const ordenadas = [...parts].sort((a, b) => a.orderIndex - b.orderIndex);

  const porEquipo = new Map<string, PartPlacement[]>();
  for (const teamId of teamIds) porEquipo.set(teamId, []);

  for (const part of ordenadas) {
    const placements = rankPart({ part, table: tableFor(part), teamIds, scores });
    for (const placement of placements) {
      porEquipo.get(placement.teamId)?.push(placement);
    }
  }

  const dir = ordenadas.length > 0 ? pointsDirection(tableFor(ordenadas[0])) : "menor_gana";
  const signo = dir === "menor_gana" ? 1 : -1;

  const entradas = teamIds.map((teamId) => {
    // rankPart devuelve los placements en el orden en que rankeo, no en el del
    // equipo, asi que se reordena por parte para que `placements` sea legible.
    const placements = (porEquipo.get(teamId) ?? []).sort((a, b) => {
      const ia = ordenadas.findIndex((p) => p.id === a.partId);
      const ib = ordenadas.findIndex((p) => p.id === b.partId);
      return ia - ib;
    });

    return {
      teamId,
      totalPoints: placements.reduce((suma, p) => suma + p.points, 0),
      placements,
      tiebreakVector: placements.map((p) => p.position).sort((a, b) => a - b),
    };
  });

  const ubicados = assignPhysicalPositions(entradas, (a, b) => {
    if (a.totalPoints !== b.totalPoints) return signo * (a.totalPoints - b.totalPoints);
    return compareTiebreakVectors(a.tiebreakVector, b.tiebreakVector);
  });

  return ubicados.map(({ item, position, tiedWith }): OverallEntry => ({
    teamId: item.teamId,
    totalPoints: item.totalPoints,
    placements: item.placements,
    tiebreakVector: item.tiebreakVector,
    position,
    tiedWith,
  }));
}
