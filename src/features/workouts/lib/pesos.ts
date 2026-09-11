/**
 * Convierte los pesos de la grilla de categorías a kilos.
 *
 * Vive fuera de actions.ts porque Next exige que TODO export de un archivo
 * "use server" sea una funcion async, y esta es pura y sincrona. De paso, asi
 * se puede testear sin levantar nada — mismo motivo que `tiempoAMs`.
 */

import { aKilos } from "@/shared/unidades/carga";
import type { LoadUnit } from "@/lib/supabase/types";

export interface CeldaDeSpec {
  divisionId: string;
  partMovementId: string;
  objetivo: number[] | null;
  /** El numero CRUDO que escribio el organizador, en `cargaUnidad` — no kilos. */
  cargaKg: number | null;
  cargaUnidad: LoadUnit;
}

/**
 * El texto del campo "Objetivo" de la grilla -> el arreglo que espera la base.
 *
 * "" -> [] (vacio = heredar el objetivo de la prueba), no [0]. Bug real:
 * "".split(/[-,\s]+/) da [""], y Number("") es 0 -que pasa el filtro de
 * "numero valido y no negativo"-, asi que un campo vacio (categoria que solo
 * queria cambiar el PESO, no las repeticiones) se guardaba como
 * `target_per_round = [0]` en vez de heredar el de la prueba. El movimiento
 * quedaba con objetivo cero y el juez lo cerraba con 0 reps sin que nadie lo
 * notara -es la misma regla que `objetivoAArreglo` ya aplica en el alta de un
 * movimiento, reimplementada aca sin el guard.
 */
export function objetivoDeCelda(bruto: string): number[] {
  const limpio = bruto.trim();
  if (!limpio) return [];
  return limpio
    .split(/[-,\s]+/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/**
 * Convierte cada celda a kilos antes de que le lleguen a la base.
 *
 * `division_movement_specs.load_kg` es SIEMPRE kilos, pero la grilla manda el
 * numero tal cual lo escribio el organizador en la unidad que eligio arriba
 * (`cargaUnidad`) — exactamente como `pesoDelFormulario()` recibe el peso de
 * UN movimiento. Pura y exportada para probarla sin mockear Supabase, la
 * misma cirugia que ya se le hizo a `recalcularWod`.
 */
export function celdasEnKilos(celdas: CeldaDeSpec[]): CeldaDeSpec[] {
  return celdas.map((c) => ({
    ...c,
    cargaKg: c.cargaKg === null ? null : aKilos(c.cargaKg, c.cargaUnidad),
  }));
}
