/**
 * La tabla general de una categoria: suma de puntos y desempate por puestos.
 */

import { assignPhysicalPositions, rankPart } from "./place";
import { pointsDirection, redondear } from "./points";
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
 * Resuelve el desempate que viene de OTRA parte, ANTES de rankear.
 *
 * `tiebreak_source = 'otra_prueba'` le pide a una parte que use, como
 * desempate, el resultado de un WOD distinto — "el desempate de la final es
 * el tiempo de la clasificatoria". `normalizeScore` no puede resolver esto:
 * es parte-por-parte y solo ve un score a la vez, y el dato que necesita esta
 * en la fila de la OTRA parte. Por eso se resuelve aca, mirando el conjunto
 * completo, y se le entrega a `computeOverall` un `RawScore[]` donde el
 * `tiebreak` de cada fila ya es el que corresponde.
 *
 * Usa SOLO el valor principal del equipo en la otra parte (nunca su
 * `capValue` ni su propio desempate): si el equipo no la completo, no hay
 * nada que darle de desempate — no es un error, es que el dato no existe, y
 * `normalizeScore` ya sabe tratar un tiebreak null como "sin desempate".
 */
export function resolverTiebreaksDeOtraPrueba(
  parts: readonly PartSpec[],
  scores: readonly RawScore[],
): RawScore[] {
  const origenPorParte = new Map(
    parts
      .filter((p) => p.tiebreakPartId !== null)
      .map((p) => [p.id, p.tiebreakPartId as string]),
  );

  if (origenPorParte.size === 0) return [...scores];

  const valorPorParteYEquipo = new Map<string, number | null>();
  for (const s of scores) {
    if (s.status === "valido") valorPorParteYEquipo.set(`${s.partId}|${s.teamId}`, s.value);
  }

  return scores.map((s) => {
    const origen = origenPorParte.get(s.partId);
    if (!origen) return s;
    return { ...s, tiebreak: valorPorParteYEquipo.get(`${origen}|${s.teamId}`) ?? null };
  });
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

    // Sumar varios `points` de 3 decimales en JS arrastra ruido de punto
    // flotante (174.222 sale 174.22199999999998). Se redondea la SUMA a la
    // misma precision de sus partes -- no se pierde nada real, solo el error
    // de representacion -- para que ordenar y mostrar partan del mismo numero.
    const totalPoints = redondear(placements.reduce((suma, p) => suma + p.points, 0));

    return {
      teamId,
      totalPoints,
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
    // Solo para mostrar: nunca se usa arriba para ordenar ni desempatar.
    displayPoints: Math.round(item.totalPoints),
    placements: item.placements,
    tiebreakVector: item.tiebreakVector,
    position,
    tiedWith,
  }));
}
