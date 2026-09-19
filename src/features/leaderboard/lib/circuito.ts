/**
 * El progreso de un atleta DENTRO de un circuito, derivado de sus parciales.
 *
 * Es logica pura: sin DOM, sin React y sin Supabase, igual que el resto de lo
 * que decide la correccion del producto. La pantalla del organizador la usa
 * para dos cosas —en que estacion esta cada atleta AHORA, y como se pinta la
 * linea de tiempo de sus parciales— y no tiene ninguna copia de estas reglas.
 *
 * El leaderboard solo trae los splits YA CERRADOS: la estacion en curso no
 * existe como dato, se DERIVA de cual es el primer segmento del circuito que
 * todavia no tiene split. Es la misma idea que gobierna todo el motor de
 * tiempos —el total no se guarda, se deriva del log— aplicada un nivel mas
 * arriba.
 */

import type { LeaderboardRow } from "../queries";
import type { LaneStatus } from "@/lib/supabase/types";

export interface SegmentoDeCircuito {
  id: string;
  orderIndex: number;
  kind: "run" | "station" | "transition";
  name: string;
}

export type EstadoDeParcial = "hecho" | "en_curso" | "pendiente";

export interface ParcialDeCircuito {
  segmento: SegmentoDeCircuito;
  estado: EstadoDeParcial;
  /** Elapsed acumulado al cerrar este segmento. null si todavia no se cerro. */
  cumulativeMs: number | null;
  /** Cuanto duro este segmento solo. null si todavia no se cerro. */
  durationMs: number | null;
}

export interface ProgresoDeCircuito {
  parciales: ParcialDeCircuito[];
  total: number;
  completados: number;
  /** El segmento que el atleta esta haciendo AHORA, o null si no esta en carrera. */
  actual: SegmentoDeCircuito | null;
  indiceActual: number | null;
  /**
   * Elapsed en el que arranco el segmento actual: el acumulado del ultimo
   * parcial cerrado, o 0 si todavia no cerro ninguno. Con esto la pantalla
   * calcula cuanto lleva en la estacion sin guardar un segundo contador.
   */
  desdeMs: number;
}

/** Un carril que ya no avanza: no hay estacion "actual" que mostrar. */
function terminado(status: LaneStatus): boolean {
  return status === "finished" || status === "dnf" || status === "dq";
}

/**
 * Cruza los parciales de un atleta con los segmentos de su circuito.
 *
 * Los splits se aparean por `orderIndex` y no por posicion en el arreglo: un
 * marcaje fuera de orden —que el reductor reporta como anomalia pero NO
 * descarta— dejaria un hueco, y contar por posicion correria de lugar todos
 * los parciales siguientes.
 */
export function progresoDeCircuito(
  row: Pick<LeaderboardRow, "splits" | "status">,
  segmentos: SegmentoDeCircuito[],
): ProgresoDeCircuito {
  const porOrden = new Map(row.splits.map((s) => [s.orderIndex, s]));

  // El primer segmento sin split es el que se esta haciendo. Se busca el hueco
  // en vez de usar `splits.length` justamente por el caso de arriba.
  const indicePendiente = segmentos.findIndex((s) => !porOrden.has(s.orderIndex));
  const enCurso = !terminado(row.status) && indicePendiente >= 0 ? indicePendiente : null;

  const parciales: ParcialDeCircuito[] = segmentos.map((segmento, i) => {
    const split = porOrden.get(segmento.orderIndex);
    return {
      segmento,
      estado: split ? "hecho" : i === enCurso ? "en_curso" : "pendiente",
      cumulativeMs: split?.cumulativeMs ?? null,
      durationMs: split?.durationMs ?? null,
    };
  });

  // El acumulado mas alto YA CERRADO, no el del segmento anterior: con un
  // marcaje fuera de orden el anterior puede estar vacio.
  const desdeMs = row.splits.reduce((max, s) => Math.max(max, s.cumulativeMs), 0);

  return {
    parciales,
    total: segmentos.length,
    completados: porOrden.size,
    actual: enCurso === null ? null : segmentos[enCurso],
    indiceActual: enCurso,
    desdeMs,
  };
}

/**
 * Cuanto suele durar cada segmento, segun lo que ya corrieron los demas.
 *
 * Es lo unico que le da una escala al indicador en vivo del tramo en curso: el
 * dato real —cuanto va a tardar ESTE atleta en ESTA estacion— no existe hasta
 * que el juez marca. Se usa la MEDIANA y no el promedio porque un DNF a medio
 * camino o un split anomalo de dos segundos corren el promedio lo suficiente
 * como para que la barra quede siempre llena o siempre vacia.
 */
export function duracionesDeReferencia(
  rows: Pick<LeaderboardRow, "splits">[],
): Map<number, number> {
  const porOrden = new Map<number, number[]>();
  for (const row of rows) {
    for (const split of row.splits) {
      if (split.durationMs <= 0) continue;
      const lista = porOrden.get(split.orderIndex) ?? [];
      lista.push(split.durationMs);
      porOrden.set(split.orderIndex, lista);
    }
  }

  const referencia = new Map<number, number>();
  for (const [orderIndex, duraciones] of porOrden) {
    duraciones.sort((a, b) => a - b);
    referencia.set(orderIndex, duraciones[Math.floor(duraciones.length / 2)]);
  }
  return referencia;
}

/**
 * Techo de cada vuelta del indicador de tramo en curso.
 *
 * Nunca llega a 1: el unico que puede decir que el segmento termino es el
 * marcaje del juez. Si el indicador se llenara y se quedara lleno, el
 * organizador leeria "ya cerro la estacion" en una pantalla que todavia no
 * recibio nada.
 */
export const TOPE_DEL_TRAMO = 0.92;

/**
 * Cuanto dura una vuelta del indicador cuando ninguno de la categoria paso
 * todavia por esa estacion y no hay con que compararse.
 */
export const VUELTA_SIN_REFERENCIA_MS = 15_000;

/**
 * Que fraccion del tramo en curso mostrar, dado cuanto lleva el atleta en el.
 *
 * El indicador es INDETERMINADO: se llena a lo largo de lo que suelen tardar los
 * demas en esa estacion, y cuando lo alcanza VUELVE A EMPEZAR, en vez de
 * quedarse lleno. Quedarse quieto al final se lee como "trabado" o como
 * "terminado", y no es ninguna de las dos cosas: lo unico que sabemos es que el
 * atleta sigue ahi hasta que el juez marque. Lo que dice cuanto lleva de verdad
 * es el reloj de debajo; esto solo dice "esta en curso".
 */
export function fraccionDelTramo(transcurridoMs: number, referenciaMs: number | null): number {
  if (transcurridoMs <= 0) return 0;
  const vuelta = referenciaMs && referenciaMs > 0 ? referenciaMs : VUELTA_SIN_REFERENCIA_MS;
  return ((transcurridoMs % vuelta) / vuelta) * TOPE_DEL_TRAMO;
}
