/**
 * Arma la estructura de un WOD a partir de las filas de la base.
 *
 * Existe para que haya UNA sola version de este ensamblado. Lo necesitan dos
 * lugares —el bundle que se lleva el celular del juez y el recalculo del
 * servidor— y si cada uno lo escribiera por su cuenta, alcanzaria con que uno
 * se olvidara de aplicar el peso de la categoria para que el juez viera 43 kg y
 * el resultado oficial se calculara con otro numero.
 *
 * Es pura: recibe filas planas y devuelve la estructura. No sabe de Supabase ni
 * de que cliente vino cada consulta.
 */

import type { MovementUnit, WodBlock, WodStructure } from "./wod";

export interface FilaDeParte {
  id: string;
  label: string;
  order_index: number;
  time_scheme: string;
  score_unit: string;
  time_cap_ms: number | null;
  window_ms: number | null;
  interval_ms: number | null;
}

export interface FilaDeBloque {
  id: string;
  part_id: string;
  order_index: number;
  kind: string;
  repeticiones: number;
  duracion_ms: number | null;
  descanso_ms: number | null;
}

export interface FilaDeMovimiento {
  id: string;
  block_id: string;
  part_id: string;
  order_index: number;
  movement_id: string | null;
  custom_name: string | null;
  unit: string;
  target_per_round: number[];
  load_kg: number | null;
  max_reps: boolean;
  es_tiebreak: boolean;
}

export interface EspecificacionDeCategoria {
  target_per_round: number[] | null;
  load_kg: number | null;
}

export function armarEstructuraDeWod(params: {
  parte: FilaDeParte;
  bloques: FilaDeBloque[];
  movimientos: FilaDeMovimiento[];
  /** Nombre del catalogo por id de movimiento. */
  nombres: Map<string, string>;
  /** Peso y reps propios de la categoria, por id de part_movement. */
  specs: Map<string, EspecificacionDeCategoria>;
}): WodStructure {
  const { parte, bloques, movimientos, nombres, specs } = params;

  const blocks: WodBlock[] = bloques
    .filter((b) => b.part_id === parte.id)
    .sort((a, b) => a.order_index - b.order_index)
    .map((b) => ({
      id: b.id,
      orderIndex: b.order_index,
      kind: b.kind as WodBlock["kind"],
      rounds: b.repeticiones,
      durationMs: b.duracion_ms,
      restMs: b.descanso_ms,
      movements: movimientos
        .filter((m) => m.block_id === b.id)
        .sort((x, y) => x.order_index - y.order_index)
        .map((m) => {
          // Rx contra Scaled: si la categoria define lo suyo, manda la
          // categoria. Es el mismo criterio que division_segment_specs para los
          // circuitos.
          const spec = specs.get(m.id);
          return {
            id: m.id,
            orderIndex: m.order_index,
            name: m.custom_name ?? nombres.get(m.movement_id ?? "") ?? "Movimiento",
            unit: m.unit as MovementUnit,
            targetPerRound: spec?.target_per_round ?? m.target_per_round,
            loadKg: spec?.load_kg ?? m.load_kg,
            maxReps: m.max_reps,
            isTiebreak: m.es_tiebreak,
          };
        }),
    }));

  return {
    scheme: parte.time_scheme as WodStructure["scheme"],
    timeCapMs: parte.time_cap_ms,
    windowMs: parte.window_ms,
    intervalMs: parte.interval_ms,
    blocks,
  };
}
