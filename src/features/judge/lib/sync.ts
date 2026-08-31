/**
 * Outbox: sincronizacion idempotente con el servidor.
 *
 * La red es opcional. El juez nunca espera por ella: el marcaje ya quedo en
 * IndexedDB, y esto solo lo empuja hacia arriba cuando se puede.
 *
 * La idempotencia sale del UUID que genera el cliente. Reintentar el mismo lote
 * mil veces produce exactamente los mismos registros del lado del servidor.
 */

import { createClient } from "@/lib/supabase/client";
import { errorIncluye } from "@/shared/utils/matchError";
import type { TimingEvent } from "@/shared/timing/types";
import { loadPending, markAttemptFailed, markSynced, type OutboxEvent } from "./db";

const BATCH_SIZE = 50;

export interface SyncOutcome {
  attempted: number;
  accepted: number;
  error: string | null;
  /**
   * true cuando el servidor rechaza por permisos y reintentar no va a cambiar
   * nada: el carril lo tomo otro juez, o se lo transfirieron. Reintentar en
   * bucle solo gastaria bateria y ocultaria el problema al juez.
   */
  fatal?: boolean;
}

/** Como viajan los marcajes hacia arriba. Inyectable para poder probar. */
export type Transport = (events: TimingEvent[]) => Promise<{ error: string | null; fatal?: boolean }>;

/**
 * Deja solo el evento de dominio: los campos de sincronizacion son contabilidad
 * del cliente y no tienen por que viajar ni existir del lado del servidor.
 */
function toDomainEvent(record: OutboxEvent): TimingEvent {
  return {
    id: record.id,
    laneId: record.laneId,
    seq: record.seq,
    type: record.type,
    segmentId: record.segmentId,
    elapsedMs: record.elapsedMs,
    payload: record.payload,
    recordedBy: record.recordedBy,
    deviceId: record.deviceId,
    clientCapturedAt: record.clientCapturedAt,
    supersedesId: record.supersedesId,
    voided: record.voided,
    voidReason: record.voidReason,
  };
}

/**
 * Transporte de produccion: el RPC de Postgres.
 *
 * `recorded_by` lo pone el servidor desde auth.uid(), asi que el campo que
 * viaja aca es informativo y no se puede usar para firmar por otro.
 */
export const supabaseTransport: Transport = async (events) => {
  const supabase = createClient();
  const { error } = await supabase.rpc("ingest_timing_events", {
    p_events: events as unknown as never,
  });

  if (!error) {
    // El leaderboard se alimenta de la tabla `results`, que es cache del log.
    // Se dispara y no se espera: si falla, el marcaje ya esta guardado igual y
    // el proximo lote (o el organizador desde la torre de control) lo recalcula.
    // Bloquear al juez por refrescar una tabla de lectura seria absurdo.
    void fetch("/api/resultados/recalcular", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ laneId: events[0]?.laneId }),
    }).catch(() => {});

    return { error: null };
  }

  // 42501 = insufficient_privilege. El carril ya no es de este juez.
  if (error.code === "42501" || errorIncluye(error.message, "otro juez")) {
    return { error: "Este carril ya no está asignado a ti.", fatal: true };
  }

  // Se muestra el mensaje real del servidor, no uno generico.
  //
  // Un "no se pudo sincronizar" a secas oculto durante toda una competencia que
  // la ingesta estaba rechazando cada marcaje por un formato de fecha. Con el
  // mensaje de Postgres a la vista, el problema se ve en el primer intento.
  return { error: `No se pudo sincronizar: ${error.message}` };
};

/** Transporte del spike: endpoint HTTP en memoria, sin base de datos. */
export const spikeTransport: Transport = async (events) => {
  try {
    const response = await fetch("/api/spike/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
    });
    return response.ok ? { error: null } : { error: `El servidor respondió ${response.status}` };
  } catch {
    return { error: "Sin conexión" };
  }
};

export async function syncPending(
  laneId: string,
  transport: Transport = supabaseTransport,
): Promise<SyncOutcome> {
  let pending: OutboxEvent[];
  try {
    pending = await loadPending(laneId);
  } catch {
    return { attempted: 0, accepted: 0, error: "No se pudo leer la cola local." };
  }

  if (pending.length === 0) return { attempted: 0, accepted: 0, error: null };

  const batch = pending.slice(0, BATCH_SIZE);
  const ids = batch.map((e) => e.id);

  const { error, fatal } = await transport(batch.map(toDomainEvent));

  if (error) {
    await markAttemptFailed(ids, error);
    return { attempted: batch.length, accepted: 0, error, fatal };
  }

  await markSynced(ids);
  return { attempted: batch.length, accepted: batch.length, error: null };
}

/**
 * Bucle de reintento con backoff.
 *
 * Se despierta ademas cuando el navegador recupera la red o cuando el juez
 * vuelve a la pestana, que son los dos momentos en que realmente vale la pena
 * reintentar.
 */
export function startSyncLoop(
  laneId: string,
  onOutcome: (outcome: SyncOutcome) => void,
  transport: Transport = supabaseTransport,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 2_000;

  const MIN_DELAY = 2_000;
  const MAX_DELAY = 60_000;

  async function tick() {
    if (stopped) return;

    const outcome = await syncPending(laneId, transport);
    if (!stopped) onOutcome(outcome);

    // Un rechazo por permisos no se reintenta rapido: no va a cambiar solo.
    if (outcome.fatal) {
      delay = MAX_DELAY;
    } else {
      delay = outcome.error ? Math.min(delay * 2, MAX_DELAY) : MIN_DELAY;
    }

    timer = setTimeout(tick, delay);
  }

  function wakeUp() {
    if (stopped) return;
    clearTimeout(timer);
    delay = MIN_DELAY;
    void tick();
  }

  void tick();
  window.addEventListener("online", wakeUp);
  document.addEventListener("visibilitychange", wakeUp);

  return () => {
    stopped = true;
    clearTimeout(timer);
    window.removeEventListener("online", wakeUp);
    document.removeEventListener("visibilitychange", wakeUp);
  };
}

const DEVICE_ID_KEY = "hybrid-crono.device-id";

/** Identifica el dispositivo para auditoria. Sobrevive a reloads. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
