/**
 * Plantillas de circuito.
 *
 * En la fase 3 estas plantillas se cargan desde Postgres y el organizador las
 * edita; por ahora viven aca para poder sembrar eventos y correr el spike con
 * una estructura realista.
 */

import type { PenaltyPayload, Segment } from "@/shared/timing/types";

function segment(orderIndex: number, kind: Segment["kind"], name: string): Segment {
  return { id: `seg-${orderIndex}`, orderIndex, kind, name };
}

/**
 * Hyrox estandar: 8 estaciones alternadas con 8 corridas de 1km.
 * El juez marca al cerrar cada segmento, asi que son 16 marcajes por carrera.
 */
export const HYROX_STANDARD: Segment[] = [
  segment(0, "run", "1km Run"),
  segment(1, "station", "SkiErg 1000m"),
  segment(2, "run", "1km Run"),
  segment(3, "station", "Sled Push 50m"),
  segment(4, "run", "1km Run"),
  segment(5, "station", "Sled Pull 50m"),
  segment(6, "run", "1km Run"),
  segment(7, "station", "Burpee Broad Jump 80m"),
  segment(8, "run", "1km Run"),
  segment(9, "station", "Rowing 1000m"),
  segment(10, "run", "1km Run"),
  segment(11, "station", "Farmers Carry 200m"),
  segment(12, "run", "1km Run"),
  segment(13, "station", "Sandbag Lunges 100m"),
  segment(14, "run", "1km Run"),
  segment(15, "station", "Wall Balls 100 reps"),
];

/** Circuito corto para probar el spike sin dar 16 taps. */
export const CIRCUITO_DEMO: Segment[] = [
  segment(0, "run", "500m Run"),
  segment(1, "station", "SkiErg 500m"),
  segment(2, "run", "500m Run"),
  segment(3, "station", "Sled Push 25m"),
  segment(4, "run", "500m Run"),
  segment(5, "station", "Wall Balls 50 reps"),
];

/** Catalogo de penalizaciones por defecto. El organizador lo ajusta por evento. */
export const PENALIZACIONES_DEMO: PenaltyPayload[] = [
  { code: "NO_REP", label: "Repeticion invalida", kind: "no_rep", seconds: 0 },
  { code: "ROM", label: "Rango de movimiento", kind: "time_add", seconds: 10 },
  { code: "ZONA", label: "Fuera de zona", kind: "time_add", seconds: 15 },
  { code: "EQUIPO", label: "Mal manejo del equipo", kind: "time_add", seconds: 30 },
  { code: "CONDUCTA", label: "Conducta antideportiva", kind: "dq", seconds: 0 },
];
