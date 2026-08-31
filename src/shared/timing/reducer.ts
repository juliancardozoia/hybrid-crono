/**
 * Reductor: log de eventos -> resultado del carril.
 *
 * Esta funcion es PURA y es el corazon del producto. Corre identica en el
 * cliente (para pintar el tiempo en vivo) y en el servidor (para el resultado
 * oficial), asi que nunca pueden diferir.
 *
 * El tiempo total no existe como dato editable en ningun lado: siempre se
 * deriva de aca.
 */

import type {
  Anomaly,
  AppliedPenalty,
  LaneResult,
  LaneStatus,
  PenaltyPayload,
  Segment,
  SplitResult,
  TimingEvent,
} from "./types";

/** Debajo de esto, dos marcajes seguidos son casi seguro un doble tap accidental. */
export const SUSPICIOUS_SPLIT_MS = 3000;

function asPenalty(event: TimingEvent): PenaltyPayload | null {
  const p = event.payload as Partial<PenaltyPayload> | undefined;
  if (!p || typeof p.code !== "string" || typeof p.kind !== "string") return null;
  return {
    code: p.code,
    label: typeof p.label === "string" ? p.label : p.code,
    kind: p.kind,
    seconds: typeof p.seconds === "number" ? p.seconds : 0,
  };
}

export function reduceLaneEvents(
  laneId: string,
  events: TimingEvent[],
  segments: Segment[],
): LaneResult {
  const anomalies: Anomaly[] = [];
  const orderedSegments = [...segments].sort((a, b) => a.orderIndex - b.orderIndex);

  const mine = events.filter((e) => e.laneId === laneId);
  const byId = new Map(mine.map((e) => [e.id, e]));

  // Un evento con supersedesId anula a su objetivo. Nada se borra: el log
  // completo sigue existiendo para auditoria, solo dejamos de contarlo.
  const superseded = new Set<string>();
  for (const e of mine) {
    if (!e.supersedesId) continue;
    if (!byId.has(e.supersedesId)) {
      anomalies.push({
        code: "orphan_undo",
        message: `El evento ${e.id} anula a ${e.supersedesId}, que no existe en este log.`,
        eventId: e.id,
      });
      continue;
    }
    superseded.add(e.supersedesId);
  }

  // Los eventos "undo" son solo contabilidad: anulan y no aportan marcaje propio.
  const active = mine
    .filter((e) => !e.voided && !superseded.has(e.id) && e.type !== "undo")
    .sort((a, b) => a.elapsedMs - b.elapsedMs || a.seq - b.seq);

  const hasStart = active.some((e) => e.type === "lane_start");
  const dqEvent = active.find(
    (e) => e.type === "dq" || (e.type === "penalty" && asPenalty(e)?.kind === "dq"),
  );
  const dnfEvent = active.find((e) => e.type === "dnf");

  // Splits: el n-esimo marcaje cierra el n-esimo segmento del circuito.
  const splitEvents = active.filter((e) => e.type === "segment_split");
  const splits: SplitResult[] = [];
  let previousCumulative = 0;

  splitEvents.forEach((event, index) => {
    const segment = orderedSegments[index];
    if (!segment) {
      anomalies.push({
        code: "extra_splits",
        message: `Marcaje sobrante: el circuito tiene ${orderedSegments.length} segmentos.`,
        eventId: event.id,
      });
      return;
    }

    const durationMs = event.elapsedMs - previousCumulative;

    if (durationMs < 0) {
      anomalies.push({
        code: "out_of_order",
        message: `El marcaje de "${segment.name}" es anterior al segmento previo.`,
        eventId: event.id,
      });
    } else if (durationMs < SUSPICIOUS_SPLIT_MS) {
      anomalies.push({
        code: "split_too_fast",
        message: `"${segment.name}" duro ${(durationMs / 1000).toFixed(1)}s. Posible doble tap.`,
        eventId: event.id,
      });
    }

    splits.push({
      segmentId: segment.id,
      segmentName: segment.name,
      orderIndex: segment.orderIndex,
      cumulativeMs: event.elapsedMs,
      durationMs: Math.max(0, durationMs),
      eventId: event.id,
    });

    previousCumulative = event.elapsedMs;
  });

  const penalties: AppliedPenalty[] = active
    .filter((e) => e.type === "penalty")
    .flatMap((e) => {
      const p = asPenalty(e);
      if (!p) return [];
      return [
        {
          eventId: e.id,
          segmentId: e.segmentId,
          code: p.code,
          label: p.label,
          kind: p.kind,
          seconds: p.seconds,
          elapsedMs: e.elapsedMs,
        },
      ];
    });

  const penaltyMs = penalties
    .filter((p) => p.kind === "time_add")
    .reduce((sum, p) => sum + p.seconds * 1000, 0);

  const completed = splits.length >= orderedSegments.length && orderedSegments.length > 0;

  let status: LaneStatus;
  if (dqEvent) status = "dq";
  else if (dnfEvent) status = "dnf";
  else if (!hasStart) status = "not_started";
  else if (completed) status = "finished";
  else status = "running";

  const rawMs = status === "finished" ? splits[splits.length - 1].cumulativeMs : null;

  // El reloj se congela en el instante en que el carril dejo de correr. Sin esto,
  // un carril en DNF mostraria el tiempo vivo y el numero cambiaria en pantalla.
  const stoppedAtMs =
    status === "dq"
      ? (dqEvent?.elapsedMs ?? null)
      : status === "dnf"
        ? (dnfEvent?.elapsedMs ?? null)
        : rawMs;

  return {
    laneId,
    status,
    rawMs,
    penaltyMs,
    totalMs: rawMs === null ? null : rawMs + penaltyMs,
    stoppedAtMs,
    splits,
    penalties,
    nextSegmentIndex:
      status === "running" || status === "not_started"
        ? Math.min(splits.length, orderedSegments.length)
        : null,
    anomalies,
  };
}

/**
 * Ordena resultados para el leaderboard: menor tiempo gana.
 * Los que no terminaron van al fondo, siempre en el orden finished > dnf > dq.
 */
export function rankResults(results: LaneResult[]): LaneResult[] {
  const statusWeight: Record<LaneStatus, number> = {
    finished: 0,
    running: 1,
    not_started: 2,
    dnf: 3,
    dq: 4,
  };

  return [...results].sort((a, b) => {
    const byStatus = statusWeight[a.status] - statusWeight[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.totalMs !== null && b.totalMs !== null) return a.totalMs - b.totalMs;
    // Entre dos que siguen corriendo, va adelante el que lleva mas segmentos hechos.
    return b.splits.length - a.splits.length;
  });
}
