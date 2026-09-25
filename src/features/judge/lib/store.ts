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
  appendRemoteEvent,
  loadAnchor,
  loadEvents,
  releaseAnchor,
  requestPersistentStorage,
  resetLane,
  saveAnchor,
  writeHeartbeat,
  type OutboxEvent,
} from "./db";
import type { HeatStartCheck } from "./bundle";
import { getDeviceId } from "./sync";

/** Ventana para deshacer un marcaje sin pedirle permiso a nadie. */
export const UNDO_WINDOW_MS = 10_000;

interface UndoTarget {
  eventId: string;
  expiresAt: number;
}

/**
 * Los marcajes que pertenecen a la largada VIGENTE.
 *
 * El celular guarda TODO lo que marco, de la largada que sea (nada se borra:
 * un tiempo no se pierde), pero solo una parte cuenta para lo que se muestra
 * y para el resultado: la de la generacion actual del heat. Un marcaje sin
 * generacion -guardado antes de que existiera- se toma como vigente, igual que
 * hace el servidor.
 */
export function eventosDeLaLargada<T extends { startGeneration?: number }>(
  events: T[],
  generation: number | null | undefined,
): T[] {
  if (generation === null || generation === undefined) return events;
  return events.filter((e) => e.startGeneration === undefined || e.startGeneration === generation);
}

export interface InitConfig {
  laneId: string;
  segments: Segment[];
  /** Largada oficial del heat en epoch ms. null si todavia no largo. */
  heatStartEpochMs: number | null;
  startOffsetMs?: number;
  /** Permite al spike trabajar sin sesion. */
  recordedBy?: string;
  /** `heats.start_generation` que conocia el dispositivo. null en el spike. */
  startGeneration?: number | null;
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
  /**
   * Ultima `start_generation` que se sabe del heat. Sirve para estampar los
   * marcajes cuando todavia no hay ancla (largada local sin señal) y para
   * detectar que la organizacion deshizo la largada.
   */
  knownGeneration: number | null;
  /**
   * Mayor `seq` de TODO el log local, de la largada que sea. `seq` es parte de
   * un indice unico en el servidor (carril, dispositivo, seq): si al volver a
   * largar se reiniciara desde 1, chocaria con los marcajes de la largada
   * deshecha y `ingest_timing_events` rechazaria el lote ENTERO.
   */
  maxSeq: number;

  init: (config: InitConfig) => Promise<void>;
  /** Ancla al reloj oficial del heat. Idempotente. */
  applyServerStart: (heatStartEpochMs: number, generation?: number) => Promise<void>;
  /**
   * Compara la generacion que informa el servidor con la del ancla. Si es
   * MAYOR, la organizacion deshizo esa largada: suelta el ancla y deja de
   * mostrar sus marcajes, sin borrar ninguno. Devuelve true si habia un reloj
   * corriendo que hubo que soltar.
   */
  syncGeneration: (generation: number) => Promise<boolean>;
  /** Aplica lo que el servidor dice de la largada: generacion primero, despues el ancla. */
  applyHeatCheck: (check: HeatStartCheck) => Promise<boolean>;
  /** Largada local, para cuando el heat arranca sin señal. */
  startLocally: () => Promise<void>;
  markSplit: () => Promise<void>;
  /**
   * Marcaje generico, para la pantalla de CrossFit.
   *
   * Existe para que contar repeticiones use EXACTAMENTE el mismo camino que
   * marcar un parcial de circuito: uuid del cliente, IndexedDB antes que la
   * red, y recien despues la UI. Duplicar ese camino en un store aparte seria
   * abrir la puerta a que uno de los dos deje de escribir a disco primero, y
   * ahi se pierde un tiempo.
   */
  markWod: (evento: {
    type: TimingEvent["type"];
    payload?: Record<string, unknown>;
    /** Los marcajes que el juez puede deshacer arman la ventana de 10s. */
    conUndo?: boolean;
  }) => Promise<void>;
  applyPenalty: (penalty: PenaltyPayload) => Promise<void>;
  undoLast: () => Promise<void>;
  finishWith: (type: "dnf" | "dq") => Promise<void>;
  refreshPending: () => Promise<void>;
  /**
   * Mezcla eventos que llegaron DEL SERVIDOR -no de un tap local- al log del
   * carril: un DNF marcado desde la torre de control, por ejemplo. Sin esto
   * el reloj del juez sigue corriendo sobre un heat que para el servidor ya
   * terminó, porque el sync normal es de solo subida.
   */
  mergeRemoteEvents: (remotos: TimingEvent[]) => Promise<void>;
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
  knownGeneration: null,
  maxSeq: 0,

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

  // Encolado ENTERO, no solo el ensureLaneStart() final -- bug real,
  // reportado como "duplicate key value violates unique constraint
  // timing_events_lane_seq_unique" y sin datos perdidos (los marcajes
  // seguian intactos en IndexedDB, era la sincronizacion la que quedaba
  // atascada para siempre detras del duplicado).
  //
  // `init()` puede llamarse dos veces casi juntas para el MISMO carril (dos
  // montajes seguidos de la pantalla del juez -React StrictMode en
  // desarrollo lo hace SIEMPRE, una vez por montaje real; en produccion,
  // cualquier remount rapido). Las dos leen `loadEvents()` -todavia sin
  // lane_start- y las dos terminan escribiendo `set({ events, ... })` con esa
  // foto vieja. Si esto no pasa por `encolar()`, el `set()` de la SEGUNDA
  // puede ejecutarse DESPUES de que la PRIMERA ya escribio su lane_start via
  // `ensureLaneStart()` -esa escritura si estaba encolada, pero nada impedia
  // que el propio `set()` de `init()` la pisara desde afuera de la cola- y
  // deja el store otra vez sin lane_start. La segunda `ensureLaneStart()` lo
  // ve vacio y agrega un SEGUNDO lane_start con el mismo seq: exactamente lo
  // que el indice unico `(lane_id, device_id, seq)` rechaza, y como
  // `ingest_timing_events` es una sola transaccion, tira TODO el lote y dejaS
  // el duplicado atascado para siempre.
  //
  // Encolar el cuerpo COMPLETO (no solo el final) hace que la lectura de
  // `loadEvents()` de la segunda llamada ocurra DESPUES de que la primera ya
  // termino de punta a punta -incluida su propia escritura- asi que ve el
  // lane_start real y no lo pisa.
  init: ({
    laneId,
    segments,
    heatStartEpochMs,
    startOffsetMs = 0,
    recordedBy = "",
    startGeneration = null,
  }) =>
    encolar(async () => {
      const persisted = await requestPersistentStorage();
      const [storedAnchor, todos] = await Promise.all([loadAnchor(laneId), loadEvents(laneId)]);

      // Re-anclar es lo que hace que refresh, reapertura y reboot devuelvan el
      // tiempo correcto: performance.now() arranco de cero en este documento.
      let anchor = storedAnchor ? rehydrateAnchor(storedAnchor) : null;
      let driftMs: number | null = null;

      // La organizacion deshizo esa largada mientras la app estaba cerrada: el
      // ancla guardada es de una carrera que ya no existe. Se suelta (el log
      // no se toca) y, si el heat ya volvio a largar, se ancla de nuevo abajo.
      if (
        anchor &&
        startGeneration !== null &&
        anchor.startGeneration !== undefined &&
        startGeneration > anchor.startGeneration
      ) {
        await releaseAnchor(laneId);
        anchor = null;
      }

      // Un ancla guardada antes de que existieran las generaciones adopta la
      // que informa el servidor, para poder detectar una largada deshecha.
      if (anchor && anchor.startGeneration === undefined && startGeneration !== null) {
        anchor = { ...anchor, startGeneration };
      }

      const events = eventosDeLaLargada(todos, anchor?.startGeneration ?? startGeneration);

      if (heatStartEpochMs !== null) {
        if (!anchor) {
          anchor = createAnchor({
            laneId,
            heatStartEpochMs,
            startOffsetMs,
            source: "server",
            startGeneration: startGeneration ?? undefined,
          });
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
        knownGeneration: anchor?.startGeneration ?? startGeneration,
        maxSeq: todos.reduce((max, e) => Math.max(max, e.seq), 0),
      });

      await ensureLaneStartSinEncolar();
    }),

  applyServerStart: async (heatStartEpochMs, generation) => {
    const { laneId, anchor, knownGeneration } = get();
    if (!laneId) return;
    if (anchor && anchor.heatStartEpochMs === heatStartEpochMs) return;

    if (!anchor) {
      const fresh = createAnchor({
        laneId,
        heatStartEpochMs,
        source: "server",
        startGeneration: generation ?? knownGeneration ?? undefined,
      });
      await saveAnchor(fresh);
      set({ anchor: fresh, knownGeneration: fresh.startGeneration ?? knownGeneration });
      await ensureLaneStart();
      return;
    }

    const { anchor: corregido, driftMs } = reconcileAnchor(anchor, heatStartEpochMs);
    await saveAnchor(corregido);
    set({ anchor: corregido, anchorDriftMs: driftMs });
    await ensureLaneStart();
  },

  syncGeneration: (generation) =>
    encolar(async () => {
      const { laneId, anchor, knownGeneration, segments } = get();
      if (!laneId) return false;

      const actual = anchor?.startGeneration ?? knownGeneration;

      // Primer contacto con el servidor desde que hay generaciones: no hay con
      // que comparar, asi que se adopta la que informa.
      if (actual === null || actual === undefined) {
        set({ knownGeneration: generation });
        if (anchor && anchor.startGeneration === undefined) {
          const adoptada = { ...anchor, startGeneration: generation };
          await saveAnchor(adoptada);
          set({ anchor: adoptada });
        }
        return false;
      }

      if (generation <= actual) {
        if (anchor && anchor.startGeneration === undefined) {
          const adoptada = { ...anchor, startGeneration: actual };
          await saveAnchor(adoptada);
          set({ anchor: adoptada });
        }
        return false;
      }

      // La organizacion deshizo la largada de este ancla. Se suelta el reloj y
      // se cambia la vista a la generacion nueva, pero el log NO se toca: lo
      // que todavia no subio sigue en la cola y sube igual.
      const habiaReloj = anchor !== null;
      if (habiaReloj) await releaseAnchor(laneId);

      const vigentes = eventosDeLaLargada(await loadEvents(laneId), generation);

      clearTimeout(undoTimer);
      set({
        anchor: null,
        knownGeneration: generation,
        events: vigentes,
        result: reduceLaneEvents(laneId, vigentes, segments),
        pendingCount: vigentes.filter((e) => e.syncState === "pending").length,
        undoTarget: null,
        anchorDriftMs: null,
      });
      return habiaReloj;
    }),

  applyHeatCheck: async (check) => {
    const deshecha = await get().syncGeneration(check.generation);
    if (check.epochMs !== null) await get().applyServerStart(check.epochMs, check.generation);
    return deshecha;
  },

  startLocally: async () => {
    const { laneId, anchor, knownGeneration } = get();
    if (!laneId || anchor) return;

    // Sin señal la largada la estampa el dispositivo. Cuando vuelva la red,
    // applyServerStart la corrige sin afectar los parciales ya marcados.
    const fresh = createAnchor({
      laneId,
      heatStartEpochMs: Date.now(),
      source: "device_offline",
      startGeneration: knownGeneration ?? undefined,
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

  markWod: async ({ type, payload, conUndo = true }) => {
    const evento = await append({ type, payload: payload ?? {} });
    if (conUndo) armUndo(evento.id, set);
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
    const { laneId, anchor, knownGeneration } = get();
    if (!laneId) return;
    const events = eventosDeLaLargada(
      await loadEvents(laneId),
      anchor?.startGeneration ?? knownGeneration,
    );
    set({ events, pendingCount: events.filter((e) => e.syncState === "pending").length });
  },

  mergeRemoteEvents: async (remotos) => {
    const { laneId, events, segments } = get();
    if (!laneId) return;

    const yaTengo = new Set(events.map((e) => e.id));
    const nuevos = remotos.filter((e) => !yaTengo.has(e.id));
    if (nuevos.length === 0) return;

    const guardados = await Promise.all(nuevos.map((e) => appendRemoteEvent(e)));
    const todos = [...events, ...guardados].sort(
      (a, b) => a.elapsedMs - b.elapsedMs || a.seq - b.seq,
    );

    set({
      events: todos,
      result: reduceLaneEvents(laneId, todos, segments),
      pendingCount: todos.filter((e) => e.syncState === "pending").length,
    });
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
      maxSeq: 0,
    });
  },
}));

/**
 * Registra el lane_start si todavia no existe.
 *
 * Cuando la largada la estampa el servidor no hay ningun tap del juez que la
 * marque, pero el reductor necesita ese evento para pasar el carril a
 * "corriendo". Es idempotente: se agrega una sola vez por carril.
 *
 * SIN encolar -a proposito. Asume que quien la llama YA esta corriendo
 * dentro de una tarea encolada (mismo patron que `appendUnaVez` vs
 * `append()`). `init()` la llama asi, desde SU PROPIA tarea encolada: si esta
 * funcion volviera a llamar a `encolar()`, esa nueva tarea quedaria esperando
 * a que la cola avance -pero la cola no avanza hasta que la tarea de `init()`
 * que la esta llamando termine de correr, y no puede terminar hasta que esto
 * resuelva-. Encolar una tarea desde adentro de otra tarea ya encolada es un
 * deadlock, no una serializacion de mas.
 */
async function ensureLaneStartSinEncolar(): Promise<void> {
  const { anchor, events } = useRaceStore.getState();
  if (!anchor) return;
  if (events.some((e) => e.type === "lane_start")) return;
  await appendUnaVez({ type: "lane_start", elapsedMs: 0 });
}

/**
 * Version publica, para llamadores que NO estan ya dentro de la cola
 * (`applyServerStart`, `startLocally`). El chequeo ("¿ya existe?") y la
 * escritura van en la MISMA tarea encolada: si se chequeara afuera, dos
 * llamadas concurrentes verian las dos "no existe" con el estado de ANTES de
 * que la otra escriba, y las dos encolarian un lane_start.
 */
async function ensureLaneStart(): Promise<void> {
  await encolar(ensureLaneStartSinEncolar);
}

function armUndo(eventId: string, set: (partial: Partial<RaceState>) => void) {
  clearTimeout(undoTimer);
  set({ undoTarget: { eventId, expiresAt: Date.now() + UNDO_WINDOW_MS } });
  undoTimer = setTimeout(() => set({ undoTarget: null }), UNDO_WINDOW_MS);
}

// Serializa toda escritura de marcaje -append() y el chequeo-e-inserta de
// ensureLaneStart()-. Sin esto, dos llamadas concurrentes -por ejemplo
// ensureLaneStart() disparado dos veces casi al mismo tiempo por
// applyServerStart() compitiendo con su propio polling de largada- leen el
// mismo `events` desactualizado: las dos ven que falta el lane_start, las dos
// calculan el MISMO `seq`, y las dos escriben. `on conflict (id)` no lo
// atrapa -son ids distintos- y `ingest_timing_events` revienta contra
// `timing_events_lane_seq_unique`, lo que tira TODO el lote (la funcion es
// una sola transaccion) y deja el marcaje duplicado atascado en la cola para
// siempre. Encolar cada tarea detras de la anterior asegura que el `events`
// que lee cada una ya incluye lo que escribio la que le precedio.
let colaDeMarcajes: Promise<unknown> = Promise.resolve();

function encolar<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = colaDeMarcajes.then(tarea);
  // Si esta tarea falla, la cola tiene que seguir andando para la proxima: el
  // propio llamador ya recibe el rechazo via `resultado`.
  colaDeMarcajes = resultado.catch(() => {});
  return resultado;
}

/**
 * Camino unico de todo marcaje: se estampa el elapsed, se escribe en IndexedDB,
 * y recien despues se actualiza la UI. Cuando esta funcion resuelve, el dato ya
 * sobrevive a que el celular se apague.
 */
function append(partial: Partial<TimingEvent> & { type: TimingEvent["type"] }): Promise<OutboxEvent> {
  return encolar(() => appendUnaVez(partial));
}

async function appendUnaVez(
  partial: Partial<TimingEvent> & { type: TimingEvent["type"] },
): Promise<OutboxEvent> {
  const state = useRaceStore.getState();
  const { laneId, segments, events, recordedBy, anchor, knownGeneration } = state;
  if (!laneId) throw new Error("El carril no esta inicializado.");

  const elapsedMs = partial.elapsedMs ?? state.currentElapsed();
  // `maxSeq` y no el maximo de `events`: `events` solo tiene la largada
  // vigente, y `seq` no puede repetirse contra lo que ya se guardo de una
  // largada anterior (indice unico carril + dispositivo + seq en el servidor).
  const seq = Math.max(state.maxSeq, events.reduce((max, e) => Math.max(max, e.seq), 0)) + 1;
  const startGeneration = anchor?.startGeneration ?? knownGeneration ?? undefined;

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
    ...(startGeneration !== undefined ? { startGeneration } : {}),
    ...partial,
  };

  const stored = await appendEvent(event);
  const nextEvents = [...events, stored];

  useRaceStore.setState({
    events: nextEvents,
    result: reduceLaneEvents(laneId, nextEvents, segments),
    pendingCount: nextEvents.filter((e) => e.syncState === "pending").length,
    maxSeq: seq,
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
