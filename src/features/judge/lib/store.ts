/**
 * Estado durable del carril.
 *
 * Atención con lo que NO esta aca: el tiempo que corre. El elapsed cambia 60 veces
 * por segundo y pasarlo por el store re-renderizaria toda la pantalla durante
 * 90 minutos seguidos. El reloj se pinta aparte (ver LiveClock) leyendo el
 * ancla directo. Aca solo vive lo que cambia cuando el juez toca algo.
 */

import { create } from "zustand";
import {
  createAnchor,
  elapsedFromAnchor,
  reconcileAnchor,
  rehydrateAnchor,
  type ClockAnchor,
} from "@/shared/timing/clock";
import { reduceLaneEvents } from "@/shared/timing/reducer";
import type { LaneResult, PenaltyPayload, Segment, TimingEvent } from "@/shared/timing/types";
import {
  appendEvent,
  loadAnchor,
  loadEvents,
  requestPersistentStorage,
  resetLane,
  saveAnchor,
  writeHeartbeat,
  type OutboxEvent,
} from "./db";
import { getDeviceId } from "./sync";

/** Ventana para deshacer un marcaje sin pedirle permiso a nadie. */
export const UNDO_WINDOW_MS = 10_000;

interface UndoTarget {
  eventId: string;
  expiresAt: number;
}

export interface InitConfig {
  laneId: string;
  segments: Segment[];
  /** Largada oficial del heat en epoch ms. null si todavia no largo. */
  heatStartEpochMs: number | null;
  startOffsetMs?: number;
  /** Permite al spike trabajar sin sesion. */
  recordedBy?: string;
}

interface RaceState {
  laneId: string | null;
  segments: Segment[];
  anchor: ClockAnchor | null;
  events: OutboxEvent[];
  result: LaneResult | null;
  pendingCount: number;
  storagePersisted: boolean;
  hydrated: boolean;
  undoTarget: UndoTarget | null;
  recordedBy: string;
  /**
   * Cuanto se corrigio el ancla al llegar la largada oficial. Distinto de cero
   * significa que el heat arranco sin señal y despues se reconcilio.
   */
  anchorDriftMs: number | null;

  init: (config: InitConfig) => Promise<void>;
  /** Ancla al reloj oficial del heat. Idempotente. */
  applyServerStart: (heatStartEpochMs: number) => Promise<void>;
  /** Largada local, para cuando el heat arranca sin señal. */
  startLocally: () => Promise<void>;
  markSplit: () => Promise<void>;
  applyPenalty: (penalty: PenaltyPayload) => Promise<void>;
  undoLast: () => Promise<void>;
  finishWith: (type: "dnf" | "dq") => Promise<void>;
  refreshPending: () => Promise<void>;
  reset: () => Promise<void>;
  /** Elapsed actual del carril. Fuente unica para estampar marcajes. */
  currentElapsed: () => number;
}

let undoTimer: ReturnType<typeof setTimeout> | undefined;

export const useRaceStore = create<RaceState>((set, get) => ({
  laneId: null,
  segments: [],
  anchor: null,
  events: [],
  result: null,
  pendingCount: 0,
  storagePersisted: false,
  hydrated: false,
  undoTarget: null,
  recordedBy: "",
  anchorDriftMs: null,

  /**
   * Elapsed con el que se estampa un marcaje.
   *
   * Redondeado a proposito: performance.now() tiene precision sub-milisegundo,
   * asi que el elapsed crudo es un decimal como 190177.19999992847, y la columna
   * de la base es entera. Se redondea y no se trunca porque truncar sesgaria
   * todos los tiempos hacia abajo de forma sistematica.
   *
   * El reloj en pantalla sigue leyendo el valor crudo: ahi el decimal no
   * molesta y formatElapsed lo recorta a centesimas igual.
   */
  currentElapsed: () => {
    const { anchor } = get();
    return anchor ? Math.round(elapsedFromAnchor(anchor, performance.now())) : 0;
  },

  init: async ({ laneId, segments, heatStartEpochMs, startOffsetMs = 0, recordedBy = "" }) => {
    const persisted = await requestPersistentStorage();
    const [storedAnchor, events] = await Promise.all([loadAnchor(laneId), loadEvents(laneId)]);

    // Re-anclar es lo que hace que refresh, reapertura y reboot devuelvan el
    // tiempo correcto: performance.now() arranco de cero en este documento.
    let anchor = storedAnchor ? rehydrateAnchor(storedAnchor) : null;
    let driftMs: number | null = null;

    if (heatStartEpochMs !== null) {
      if (!anchor) {
        anchor = createAnchor({ laneId, heatStartEpochMs, startOffsetMs, source: "server" });
      } else if (anchor.heatStartEpochMs !== heatStartEpochMs) {
        // El heat habia arrancado en el dispositivo y ahora llego la largada
        // oficial. Los parciales no se tocan: son relativos al ancla, asi que
        // corregir el punto de partida los corrige a todos de una.
        const reconciliado = reconcileAnchor(anchor, heatStartEpochMs);
        anchor = reconciliado.anchor;
        driftMs = reconciliado.driftMs;
      }
    }

    if (anchor) await saveAnchor(anchor);

    set({
      laneId,
      segments,
      anchor,
      events,
      result: reduceLaneEvents(laneId, events, segments),
      pendingCount: events.filter((e) => e.syncState === "pending").length,
      storagePersisted: persisted,
      hydrated: true,
      undoTarget: null,
      recordedBy,
      anchorDriftMs: driftMs,
    });

    await ensureLaneStart();
  },

  applyServerStart: async (heatStartEpochMs) => {
    const { laneId, anchor } = get();
    if (!laneId) return;
    if (anchor && anchor.heatStartEpochMs === heatStartEpochMs) return;

    if (!anchor) {
      const fresh = createAnchor({ laneId, heatStartEpochMs, source: "server" });
      await saveAnchor(fresh);
      set({ anchor: fresh });
      await ensureLaneStart();
      return;
    }

    const { anchor: corregido, driftMs } = reconcileAnchor(anchor, heatStartEpochMs);
    await saveAnchor(corregido);
    set({ anchor: corregido, anchorDriftMs: driftMs });
    await ensureLaneStart();
  },

  startLocally: async () => {
    const { laneId, anchor } = get();
    if (!laneId || anchor) return;

    // Sin señal la largada la estampa el dispositivo. Cuando vuelva la red,
    // applyServerStart la corrige sin afectar los parciales ya marcados.
    const fresh = createAnchor({
      laneId,
      heatStartEpochMs: Date.now(),
      source: "device_offline",
    });
    await saveAnchor(fresh);
    set({ anchor: fresh });

    await append({ type: "lane_start", elapsedMs: 0 });
  },

  markSplit: async () => {
    const { result, segments } = get();
    if (!result || result.nextSegmentIndex === null) return;

    const segment = segments[result.nextSegmentIndex];
    const event = await append({
      type: "segment_split",
      segmentId: segment?.id ?? null,
    });

    armUndo(event.id, set);
  },

  applyPenalty: async (penalty) => {
    const { result, segments } = get();
    const index = result?.nextSegmentIndex ?? null;
    const event = await append({
      type: "penalty",
      segmentId: index !== null ? (segments[index]?.id ?? null) : null,
      payload: { ...penalty },
    });

    armUndo(event.id, set);
  },

  undoLast: async () => {
    const target = get().undoTarget;
    if (!target) return;

    // No se borra nada: se agrega un evento que anula al anterior. El log
    // completo queda para auditoria.
    await append({ type: "undo", supersedesId: target.eventId });

    clearTimeout(undoTimer);
    set({ undoTarget: null });
  },

  finishWith: async (type) => {
    await append({ type });
    clearTimeout(undoTimer);
    set({ undoTarget: null });
  },

  refreshPending: async () => {
    const { laneId } = get();
    if (!laneId) return;
    const events = await loadEvents(laneId);
    set({ events, pendingCount: events.filter((e) => e.syncState === "pending").length });
  },

  reset: async () => {
    const { laneId, segments } = get();
    if (!laneId) return;
    clearTimeout(undoTimer);
    await resetLane(laneId);
    set({
      anchor: null,
      events: [],
      result: reduceLaneEvents(laneId, [], segments),
      pendingCount: 0,
      undoTarget: null,
      anchorDriftMs: null,
    });
  },
}));

/**
 * Registra el lane_start si todavia no existe.
 *
 * Cuando la largada la estampa el servidor no hay ningun tap del juez que la
 * marque, pero el reductor necesita ese evento para pasar el carril a
 * "corriendo". Es idempotente: se agrega una sola vez por carril.
 */
async function ensureLaneStart(): Promise<void> {
  const { anchor, events } = useRaceStore.getState();
  if (!anchor) return;
  if (events.some((e) => e.type === "lane_start")) return;
  await append({ type: "lane_start", elapsedMs: 0 });
}

function armUndo(eventId: string, set: (partial: Partial<RaceState>) => void) {
  clearTimeout(undoTimer);
  set({ undoTarget: { eventId, expiresAt: Date.now() + UNDO_WINDOW_MS } });
  undoTimer = setTimeout(() => set({ undoTarget: null }), UNDO_WINDOW_MS);
}

/**
 * Camino unico de todo marcaje: se estampa el elapsed, se escribe en IndexedDB,
 * y recien despues se actualiza la UI. Cuando esta funcion resuelve, el dato ya
 * sobrevive a que el celular se apague.
 */
async function append(
  partial: Partial<TimingEvent> & { type: TimingEvent["type"] },
): Promise<OutboxEvent> {
  const state = useRaceStore.getState();
  const { laneId, segments, events, recordedBy } = state;
  if (!laneId) throw new Error("El carril no esta inicializado.");

  const elapsedMs = partial.elapsedMs ?? state.currentElapsed();
  const seq = events.reduce((max, e) => Math.max(max, e.seq), 0) + 1;

  const event: TimingEvent = {
    id: crypto.randomUUID(),
    laneId,
    seq,
    segmentId: null,
    elapsedMs,
    payload: {},
    // Informativo: el servidor lo reescribe con auth.uid(), asi que no se puede
    // firmar por otro aunque se manipule el cliente.
    recordedBy,
    deviceId: getDeviceId(),
    clientCapturedAt: Date.now(),
    supersedesId: null,
    voided: false,
    voidReason: null,
    ...partial,
  };

  const stored = await appendEvent(event);
  const nextEvents = [...events, stored];

  useRaceStore.setState({
    events: nextEvents,
    result: reduceLaneEvents(laneId, nextEvents, segments),
    pendingCount: nextEvents.filter((e) => e.syncState === "pending").length,
  });

  return stored;
}

/** Latido de auditoria. No alimenta el cronometro; deja rastro de vida del carril. */
export function startHeartbeat(intervalMs = 1_000): () => void {
  const timer = setInterval(() => {
    const { laneId, anchor, currentElapsed } = useRaceStore.getState();
    if (!laneId || !anchor) return;
    void writeHeartbeat({ laneId, elapsedMs: currentElapsed(), epochMs: Date.now() });
  }, intervalMs);

  return () => clearInterval(timer);
}
