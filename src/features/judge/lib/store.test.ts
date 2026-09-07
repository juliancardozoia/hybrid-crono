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

const guardados: Array<{ id: string; type: string; seq: number }> = [];

vi.mock("./db", () => ({
  requestPersistentStorage: async () => true,
  loadAnchor: async () => null,
  loadEvents: async () => [],
  saveAnchor: async () => {},
  writeHeartbeat: async () => {},
  resetLane: async () => {},
  appendEvent: async (e: { id: string; type: string; seq: number }) => {
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
});
