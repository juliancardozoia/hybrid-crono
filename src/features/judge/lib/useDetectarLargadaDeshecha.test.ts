// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeatStartCheck } from "./bundle";

const syncGeneration = vi.fn();
let estado: { anchor: object | null; result: { status: string } | null; syncGeneration: typeof syncGeneration };

vi.mock("./store", () => ({
  useRaceStore: <T,>(selector: (s: typeof estado) => T) => selector(estado),
}));

const { useDetectarLargadaDeshecha, INTERVALO_DE_LARGADA_MS } = await import(
  "./useDetectarLargadaDeshecha"
);

beforeEach(() => {
  vi.useFakeTimers();
  syncGeneration.mockReset();
  syncGeneration.mockResolvedValue(false);
  estado = { anchor: {}, result: { status: "running" }, syncGeneration };
});

afterEach(() => {
  vi.useRealTimers();
});

async function pasar(veces: number) {
  for (let i = 0; i < veces; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DE_LARGADA_MS);
    });
  }
}

describe("useDetectarLargadaDeshecha", () => {
  it("pregunta cada pocos segundos mientras haya un reloj corriendo", async () => {
    const onCheck = vi.fn(async (): Promise<HeatStartCheck | null> => ({ epochMs: 1, generation: 0 }));
    renderHook(() => useDetectarLargadaDeshecha(onCheck, true));

    await pasar(3);

    expect(onCheck).toHaveBeenCalledTimes(3);
  });

  it("con una generacion mayor suelta el reloj y avisa, en UNA sola respuesta", async () => {
    syncGeneration.mockResolvedValue(true);
    const onCheck = vi.fn(async (): Promise<HeatStartCheck | null> => ({ epochMs: null, generation: 1 }));
    const onDeshecha = vi.fn();
    renderHook(() => useDetectarLargadaDeshecha(onCheck, true, onDeshecha));

    await pasar(1);

    expect(syncGeneration).toHaveBeenCalledWith(1);
    expect(onDeshecha).toHaveBeenCalledTimes(1);
  });

  // Antes hacian falta tres respuestas seguidas de "no arranco" porque un error
  // de red se veia igual. Ahora una respuesta que no llego no concluye NADA.
  it("una respuesta que no llego (sin señal) nunca suelta el reloj", async () => {
    const onCheck = vi.fn(async (): Promise<HeatStartCheck | null> => null);
    const onDeshecha = vi.fn();
    renderHook(() => useDetectarLargadaDeshecha(onCheck, true, onDeshecha));

    await pasar(10);

    expect(syncGeneration).not.toHaveBeenCalled();
    expect(onDeshecha).not.toHaveBeenCalled();
  });

  it("un heat sin largar pero con la misma generacion no suelta nada (largada local sin señal)", async () => {
    const onCheck = vi.fn(async (): Promise<HeatStartCheck | null> => ({ epochMs: null, generation: 0 }));
    const onDeshecha = vi.fn();
    renderHook(() => useDetectarLargadaDeshecha(onCheck, true, onDeshecha));

    await pasar(5);

    expect(onDeshecha).not.toHaveBeenCalled();
  });

  it("sin reloj corriendo no pregunta", async () => {
    estado.anchor = null;
    const onCheck = vi.fn(async (): Promise<HeatStartCheck | null> => ({ epochMs: 1, generation: 0 }));
    renderHook(() => useDetectarLargadaDeshecha(onCheck, true));

    await pasar(3);

    expect(onCheck).not.toHaveBeenCalled();
  });

  it("sin señal no pregunta", async () => {
    const onCheck = vi.fn(async (): Promise<HeatStartCheck | null> => ({ epochMs: 1, generation: 0 }));
    renderHook(() => useDetectarLargadaDeshecha(onCheck, false));

    await pasar(3);

    expect(onCheck).not.toHaveBeenCalled();
  });

  it("con el carril terminado deja de preguntar", async () => {
    estado.result = { status: "finished" };
    const onCheck = vi.fn(async (): Promise<HeatStartCheck | null> => ({ epochMs: 1, generation: 0 }));
    renderHook(() => useDetectarLargadaDeshecha(onCheck, true));

    await pasar(3);

    expect(onCheck).not.toHaveBeenCalled();
  });
});
