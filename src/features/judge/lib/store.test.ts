/**
 * Regresion de un bug real, reportado como error de sincronizacion en
 * produccion: "duplicate key value violates unique constraint
 * timing_events_lane_seq_unique".
 *
 * La causa era una condicion de carrera en `ensureLaneStart()`: dos llamadas
 * casi simultaneas -por ejemplo `applyServerStart()` compitiendo con su
 * propio polling de largada- leian el mismo `events` desactualizado, las dos
 * calculaban el mismo `seq`, y las dos encolaban un `lane_start`. Distintos
 * ids pasan el `on conflict (id)` del servidor, pero chocan contra el indice
 * unico `(lane_id, device_id, seq)` y tiran TODO el lote -la funcion de
 * ingesta es una sola transaccion- dejando el duplicado atascado para
 * siempre en la cola local.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const guardados: Array<{ id: string; laneId: string; type: string; seq: number }> = [];
let llamadasASaveAnchor = 0;

vi.mock("./db", () => ({
  requestPersistentStorage: async () => true,
  loadAnchor: async () => null,
  // FIEL a IndexedDB de verdad: devuelve lo que ya se escribio para ESE
  // carril, no un `[]` fijo. Un mock que ignora `guardados` no puede exponer
  // esta clase de bug: la lectura de la SEGUNDA llamada tiene que reflejar lo
  // que la PRIMERA ya escribio si para ese momento ya lo escribio.
  loadEvents: async (laneId: string) => guardados.filter((g) => g.laneId === laneId),
  // La demora real no esta en LEER (las dos llamadas arrancan juntas y las
  // dos ven, con razon, que el carril esta vacio) sino en lo que pasa DESPUES
  // de leer y ANTES de escribir el resultado en el store: en produccion eso
  // es tiempo de verdad (IndexedDB, el scheduler del navegador). Demorar la
  // SEGUNDA llamada a `saveAnchor` -que en `init()` corre justo antes del
  // `set({ events, ... })`- alcanza para que, cuando esa segunda llamada
  // recien esta por pisar el estado, la PRIMERA ya haya terminado de punta a
  // punta -incluido su propio `ensureLaneStart()`-. Sin encolar el cuerpo
  // ENTERO de `init()` (no solo el `ensureLaneStart()` final), ese `set()`
  // tardio pisa el lane_start que la primera ya escribio.
  saveAnchor: async () => {
    llamadasASaveAnchor += 1;
    if (llamadasASaveAnchor > 1) await new Promise((r) => setTimeout(r, 20));
  },
  writeHeartbeat: async () => {},
  resetLane: async () => {},
  appendEvent: async (e: { id: string; laneId: string; type: string; seq: number }) => {
    // Simula la escritura real en IndexedDB: tarda un tick, asi que dos
    // llamadas que arrancan casi juntas pueden efectivamente solaparse si no
    // hay nada que las serialice.
    await Promise.resolve();
    const guardado = { ...e, syncState: "pending" as const, syncAttempts: 0 };
    guardados.push(guardado);
    return guardado;
  },
}));

vi.mock("./sync", () => ({
  getDeviceId: () => "dispositivo-de-prueba",
}));

const { useRaceStore } = await import("./store");

beforeEach(() => {
  guardados.length = 0;
  llamadasASaveAnchor = 0;
  useRaceStore.setState({
    laneId: "lane-1",
    segments: [],
    anchor: null,
    events: [],
    result: null,
    pendingCount: 0,
    hydrated: true,
    undoTarget: null,
    recordedBy: "juez-1",
    anchorDriftMs: null,
  });
});

describe("ensureLaneStart no duplica el lane_start bajo concurrencia", () => {
  it("dos applyServerStart casi simultaneos dejan UN solo lane_start, no dos con el mismo seq", async () => {
    const epoch = Date.now() - 30_000;

    // Las dos llamadas arrancan sin esperarse: es la condicion real que
    // produce el bug, no una simulacion artificial con locks manuales.
    await Promise.all([
      useRaceStore.getState().applyServerStart(epoch),
      useRaceStore.getState().applyServerStart(epoch),
    ]);

    const laneStarts = useRaceStore.getState().events.filter((e) => e.type === "lane_start");
    expect(laneStarts).toHaveLength(1);

    // Y por las dudas, que la base tampoco haya recibido dos filas con el
    // mismo seq -que es exactamente lo que el indice unico rechaza.
    const seqs = guardados.filter((g) => g.type === "lane_start").map((g) => g.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  /**
   * Mismo bug, mismo sintoma, otro disparador real: `init()` hacia
   * `loadEvents()` -> `set({ events, ... })` -> `ensureLaneStart()` SIN pasar
   * por `encolar()`. Si `JudgeScreen` monta dos veces casi juntas para el
   * mismo carril (React StrictMode en desarrollo lo hace SIEMPRE, dos veces
   * en cada montaje; en produccion, cualquier remount rapido del mismo
   * carril), las dos llamadas leen el mismo `events` vacio de IndexedDB, la
   * PRIMERA escribe su lane_start y actualiza el store -- pero la SEGUNDA ya
   * habia capturado un `events` vacio ANTES de esa escritura, y su propio
   * `set({ events: [] , ... })` lo pisa de vuelta a vacio. `ensureLaneStart`
   * de la segunda ve "vacio" otra vez y escribe un SEGUNDO lane_start con el
   * mismo seq. Es el mismo mecanismo documentado arriba para
   * `applyServerStart`, pero `init` nunca paso por `encolar()`.
   */
  it("dos init() casi simultaneos para el mismo carril dejan UN solo lane_start", async () => {
    const params = {
      laneId: "lane-1",
      segments: [],
      heatStartEpochMs: Date.now() - 30_000,
      startOffsetMs: 0,
      recordedBy: "juez-1",
    };

    await Promise.all([
      useRaceStore.getState().init(params),
      useRaceStore.getState().init(params),
    ]);

    const laneStarts = useRaceStore.getState().events.filter((e) => e.type === "lane_start");
    expect(laneStarts).toHaveLength(1);

    const seqs = guardados.filter((g) => g.type === "lane_start").map((g) => g.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
