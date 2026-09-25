/**
 * Cuando la organizacion deshace una largada, el celular del juez:
 *   - suelta el reloj,
 *   - deja de mostrar los marcajes de esa largada,
 *   - pero NO borra ninguno (lo que no subio sigue en la cola y sube igual),
 *   - y al volver a largar no reutiliza `seq` (indice unico en el servidor).
 *
 * Es el requisito que gobierna el producto: un tiempo no se pierde nunca.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClockAnchor } from "@/shared/timing/clock";

type Guardado = {
  id: string;
  laneId: string;
  type: string;
  seq: number;
  startGeneration?: number;
  syncState: "pending" | "synced";
  syncAttempts: number;
};

const guardados: Guardado[] = [];
let anclaGuardada: ClockAnchor | null = null;
const releaseAnchor = vi.fn(async () => {
  anclaGuardada = null;
});
const resetLane = vi.fn(async () => {});

vi.mock("./db", () => ({
  requestPersistentStorage: async () => true,
  loadAnchor: async () => anclaGuardada,
  loadEvents: async (laneId: string) => guardados.filter((g) => g.laneId === laneId),
  saveAnchor: async (a: ClockAnchor) => {
    anclaGuardada = a;
  },
  writeHeartbeat: async () => {},
  releaseAnchor: () => releaseAnchor(),
  resetLane: () => resetLane(),
  appendRemoteEvent: async (e: Guardado) => e,
  appendEvent: async (e: Omit<Guardado, "syncState" | "syncAttempts">) => {
    const guardado: Guardado = { ...e, syncState: "pending", syncAttempts: 0 };
    guardados.push(guardado);
    return guardado;
  },
}));

vi.mock("./sync", () => ({
  getDeviceId: () => "dispositivo-de-prueba",
}));

const { useRaceStore, eventosDeLaLargada } = await import("./store");

const LANE = "lane-1";

function estadoInicial() {
  useRaceStore.setState({
    laneId: LANE,
    segments: [],
    anchor: null,
    events: [],
    result: null,
    pendingCount: 0,
    hydrated: true,
    undoTarget: null,
    recordedBy: "juez-1",
    anchorDriftMs: null,
    knownGeneration: null,
    maxSeq: 0,
  });
}

beforeEach(() => {
  guardados.length = 0;
  anclaGuardada = null;
  releaseAnchor.mockClear();
  resetLane.mockClear();
  estadoInicial();
});

describe("eventosDeLaLargada", () => {
  const e = (startGeneration?: number) => ({ startGeneration });

  it("sin generacion vigente no filtra nada", () => {
    expect(eventosDeLaLargada([e(0), e(1)], null)).toHaveLength(2);
    expect(eventosDeLaLargada([e(0), e(1)], undefined)).toHaveLength(2);
  });

  it("deja solo los de la generacion vigente", () => {
    expect(eventosDeLaLargada([e(0), e(1), e(1)], 1)).toHaveLength(2);
  });

  it("un marcaje sin generacion (anterior a esto) se toma como vigente", () => {
    expect(eventosDeLaLargada([e(undefined), e(0)], 1)).toHaveLength(1);
  });
});

describe("estampado de la generacion", () => {
  it("cada marcaje sale con la generacion del ancla", async () => {
    await useRaceStore.getState().applyServerStart(Date.now() - 5_000, 3);
    await useRaceStore.getState().markSplit();

    expect(guardados.length).toBeGreaterThan(0);
    expect(guardados.every((g) => g.startGeneration === 3)).toBe(true);
  });

  it("sin generacion conocida (spike) no se estampa nada", async () => {
    await useRaceStore.getState().applyServerStart(Date.now() - 5_000);

    expect(guardados.every((g) => g.startGeneration === undefined)).toBe(true);
  });
});

describe("syncGeneration", () => {
  async function conRelojCorriendo(generation: number) {
    await useRaceStore.getState().applyServerStart(Date.now() - 20_000, generation);
    await useRaceStore.getState().markWod({ type: "rep", payload: { partId: "p" } });
  }

  it("con la misma generacion no cambia nada", async () => {
    await conRelojCorriendo(0);

    const deshecha = await useRaceStore.getState().syncGeneration(0);

    expect(deshecha).toBe(false);
    expect(useRaceStore.getState().anchor).not.toBeNull();
    expect(releaseAnchor).not.toHaveBeenCalled();
  });

  it("con una generacion mayor suelta el reloj y avisa que habia uno corriendo", async () => {
    await conRelojCorriendo(0);

    const deshecha = await useRaceStore.getState().syncGeneration(1);

    expect(deshecha).toBe(true);
    expect(useRaceStore.getState().anchor).toBeNull();
    expect(useRaceStore.getState().knownGeneration).toBe(1);
    expect(releaseAnchor).toHaveBeenCalledTimes(1);
  });

  // EL REQUISITO QUE GOBIERNA TODO.
  it("NO borra ningun marcaje: siguen guardados (y subiendo) aunque ya no se muestren", async () => {
    await conRelojCorriendo(0);
    const antes = guardados.length;
    expect(antes).toBeGreaterThan(1);

    await useRaceStore.getState().syncGeneration(1);

    expect(resetLane).not.toHaveBeenCalled();
    expect(guardados).toHaveLength(antes);
    // Lo que se muestra es solo la largada vigente: ninguna.
    expect(useRaceStore.getState().events).toHaveLength(0);
  });

  it("una respuesta con generacion menor (dato viejo) no suelta nada", async () => {
    await conRelojCorriendo(2);

    const deshecha = await useRaceStore.getState().syncGeneration(1);

    expect(deshecha).toBe(false);
    expect(useRaceStore.getState().anchor).not.toBeNull();
  });

  it("sin reloj corriendo solo pone al dia la generacion", async () => {
    useRaceStore.setState({ knownGeneration: 0 });

    const deshecha = await useRaceStore.getState().syncGeneration(1);

    expect(deshecha).toBe(false);
    expect(useRaceStore.getState().knownGeneration).toBe(1);
  });

  it("un ancla guardada antes de las generaciones adopta la del servidor", async () => {
    await useRaceStore.getState().applyServerStart(Date.now() - 20_000);
    expect(useRaceStore.getState().anchor?.startGeneration).toBeUndefined();

    const deshecha = await useRaceStore.getState().syncGeneration(4);

    expect(deshecha).toBe(false);
    expect(useRaceStore.getState().anchor?.startGeneration).toBe(4);
  });
});

describe("volver a largar despues de deshacer", () => {
  it("el lane_start nuevo lleva la generacion nueva y un seq que no choca con los viejos", async () => {
    await useRaceStore.getState().applyServerStart(Date.now() - 20_000, 0);
    await useRaceStore.getState().markWod({ type: "rep", payload: { partId: "p" } });
    await useRaceStore.getState().markWod({ type: "rep", payload: { partId: "p" } });
    const seqsViejos = guardados.map((g) => g.seq);

    await useRaceStore.getState().applyHeatCheck({ epochMs: null, generation: 1 });
    expect(useRaceStore.getState().anchor).toBeNull();

    // La organizacion vuelve a largar.
    await useRaceStore.getState().applyHeatCheck({ epochMs: Date.now() - 1_000, generation: 1 });

    const nuevos = guardados.filter((g) => g.startGeneration === 1);
    expect(nuevos.map((g) => g.type)).toEqual(["lane_start"]);

    // Indice unico (carril, dispositivo, seq): no puede repetirse ninguno.
    const todos = guardados.map((g) => g.seq);
    expect(new Set(todos).size).toBe(todos.length);
    expect(nuevos[0].seq).toBeGreaterThan(Math.max(...seqsViejos));

    // Y la pantalla ve solo la largada nueva.
    expect(useRaceStore.getState().events.map((e) => e.type)).toEqual(["lane_start"]);
  });

  it("los marcajes viejos no cuentan para el resultado de la carrera nueva", async () => {
    await useRaceStore.getState().applyServerStart(Date.now() - 20_000, 0);
    await useRaceStore.getState().markWod({ type: "rep", payload: { partId: "p" } });

    await useRaceStore.getState().applyHeatCheck({ epochMs: null, generation: 1 });
    await useRaceStore.getState().applyHeatCheck({ epochMs: Date.now() - 1_000, generation: 1 });

    const tipos = useRaceStore.getState().events.map((e) => e.type);
    expect(tipos).not.toContain("rep");
  });
});

describe("init con un ancla de una largada que se deshizo con la app cerrada", () => {
  const anclaVieja = (): ClockAnchor => ({
    laneId: LANE,
    heatStartEpochMs: Date.now() - 600_000,
    startOffsetMs: 0,
    capturedEpochMs: Date.now() - 1_000,
    capturedPerfMs: 0,
    source: "server",
    startGeneration: 0,
  });

  it("suelta el ancla vieja y ancla de nuevo si el heat ya volvio a largar", async () => {
    anclaGuardada = anclaVieja();
    guardados.push({
      id: "viejo",
      laneId: LANE,
      type: "segment_split",
      seq: 5,
      startGeneration: 0,
      syncState: "pending",
      syncAttempts: 0,
    });

    const epochNuevo = Date.now() - 2_000;
    await useRaceStore.getState().init({
      laneId: LANE,
      segments: [],
      heatStartEpochMs: epochNuevo,
      recordedBy: "juez-1",
      startGeneration: 1,
    });

    expect(releaseAnchor).toHaveBeenCalledTimes(1);
    const { anchor, events, maxSeq } = useRaceStore.getState();
    expect(anchor?.startGeneration).toBe(1);
    expect(anchor?.heatStartEpochMs).toBe(epochNuevo);
    // El marcaje viejo sigue guardado pero no se muestra, y su seq se respeta.
    expect(guardados.some((g) => g.id === "viejo")).toBe(true);
    expect(events.some((e) => e.id === "viejo")).toBe(false);
    expect(maxSeq).toBeGreaterThanOrEqual(5);
    expect(guardados.find((g) => g.type === "lane_start")!.seq).toBeGreaterThan(5);
  });

  it("si el heat todavia no largo queda esperando, sin ancla", async () => {
    anclaGuardada = anclaVieja();

    await useRaceStore.getState().init({
      laneId: LANE,
      segments: [],
      heatStartEpochMs: null,
      recordedBy: "juez-1",
      startGeneration: 1,
    });

    expect(useRaceStore.getState().anchor).toBeNull();
  });

  it("con la misma generacion conserva el ancla (reapertura normal)", async () => {
    anclaGuardada = anclaVieja();

    await useRaceStore.getState().init({
      laneId: LANE,
      segments: [],
      heatStartEpochMs: anclaGuardada.heatStartEpochMs,
      recordedBy: "juez-1",
      startGeneration: 0,
    });

    expect(releaseAnchor).not.toHaveBeenCalled();
    expect(useRaceStore.getState().anchor?.startGeneration).toBe(0);
  });
});
