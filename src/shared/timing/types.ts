/**
 * Tipos del motor de tiempos.
 *
 * Regla que gobierna todo este modulo: los tiempos se expresan SIEMPRE como
 * `elapsedMs` relativo a la largada del heat, nunca como reloj de pared.
 * El ranking solo necesita tiempo transcurrido, asi que un celular con la hora
 * mal o un heat que arranco sin senal siguen produciendo resultados exactos.
 */

export type TimingEventType =
  | "lane_start"
  | "segment_split"
  | "penalty"
  | "undo"
  | "dnf"
  | "dq"
  // Observacion del juez sin efecto sobre el tiempo. El reductor la ignora a
  // proposito: existe para que quede en el log y la organizacion la lea al
  // verificar.
  | "note";

export type PenaltyKind = "time_add" | "no_rep" | "dq";

export type PenaltyPayload = {
  code: string;
  label: string;
  kind: PenaltyKind;
  /** Segundos que se suman al tiempo bruto. Solo aplica a kind === "time_add". */
  seconds: number;
}

/** Un marcaje del juez. Inmutable: nunca se edita ni se borra, solo se supersede. */
export type TimingEvent = {
  /** UUID v4 generado en el CLIENTE. Es la clave de idempotencia de la sincronizacion. */
  id: string;
  laneId: string;
  /** Orden monotono local del dispositivo. Desempata eventos con el mismo elapsedMs. */
  seq: number;
  type: TimingEventType;
  segmentId: string | null;
  /** Milisegundos desde la largada del heat. */
  elapsedMs: number;
  payload: Record<string, unknown>;
  recordedBy: string;
  deviceId: string;
  /** Reloj de pared del dispositivo. Informativo, para auditoria. Nunca se usa para rankear. */
  clientCapturedAt: number;
  /** Si esta seteado, este evento anula al que apunta. */
  supersedesId: string | null;
  voided: boolean;
  voidReason: string | null;
}

export type SegmentKind = "run" | "station" | "transition";

export type Segment = {
  id: string;
  orderIndex: number;
  kind: SegmentKind;
  name: string;
}

// Alias de tipo y no interface: splits y anomalies se guardan como jsonb, y el
// tipo Json de supabase-js exige la index signature implicita que solo tienen
// los alias. Con interface compila el modulo pero revienta en el upsert.
export type SplitResult = {
  segmentId: string;
  segmentName: string;
  orderIndex: number;
  /** Elapsed acumulado en el momento en que se cerro este segmento. */
  cumulativeMs: number;
  /** Duracion de este segmento solo. */
  durationMs: number;
  eventId: string;
}

export type AppliedPenalty = {
  eventId: string;
  segmentId: string | null;
  code: string;
  label: string;
  kind: PenaltyKind;
  seconds: number;
  elapsedMs: number;
}

export type LaneStatus = "not_started" | "running" | "finished" | "dnf" | "dq";

export type AnomalyCode =
  | "split_too_fast"
  | "out_of_order"
  | "extra_splits"
  | "orphan_undo";

export type Anomaly = {
  code: AnomalyCode;
  message: string;
  eventId: string | null;
}

export type LaneResult = {
  laneId: string;
  status: LaneStatus;
  /** Tiempo bruto al cruzar la meta, sin penalizaciones. null si no termino. */
  rawMs: number | null;
  /** Suma de penalizaciones de tipo time_add. */
  penaltyMs: number;
  /** rawMs + penaltyMs. Este es el tiempo que rankea. */
  totalMs: number | null;
  /**
   * Elapsed del evento que detuvo el carril: la meta, el DNF o el DQ.
   * Es lo que se muestra en el reloj congelado, para que no siga cambiando.
   */
  stoppedAtMs: number | null;
  splits: SplitResult[];
  penalties: AppliedPenalty[];
  /** Indice del proximo segmento a marcar, o null si ya termino. */
  nextSegmentIndex: number | null;
  anomalies: Anomaly[];
}
