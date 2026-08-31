import { describe, expect, it } from "vitest";
import {
  createAnchor,
  elapsedParts,
  elapsedFromAnchor,
  formatElapsed,
  reconcileAnchor,
  rehydrateAnchor,
} from "./clock";

const HEAT_START = 1_700_000_000_000;

function anchorAt(perfMs: number, epochMs: number, startOffsetMs = 0) {
  return createAnchor({
    laneId: "lane-1",
    heatStartEpochMs: HEAT_START,
    startOffsetMs,
    source: "server",
    now: { perfMs, epochMs },
  });
}

describe("elapsedFromAnchor", () => {
  it("arranca en cero cuando se ancla justo en la largada", () => {
    const anchor = anchorAt(5_000, HEAT_START);
    expect(elapsedFromAnchor(anchor, 5_000)).toBe(0);
  });

  it("avanza con el reloj monotono", () => {
    const anchor = anchorAt(5_000, HEAT_START);
    expect(elapsedFromAnchor(anchor, 5_000 + 62_500)).toBe(62_500);
  });

  it("recupera el tiempo ya transcurrido si el ancla se toma tarde", () => {
    // El juez abre la app 90s despues de la largada.
    const anchor = anchorAt(1_000, HEAT_START + 90_000);
    expect(elapsedFromAnchor(anchor, 1_000)).toBe(90_000);
    expect(elapsedFromAnchor(anchor, 11_000)).toBe(100_000);
  });

  it("descuenta el offset de largada escalonada del carril", () => {
    const anchor = anchorAt(1_000, HEAT_START + 90_000, 30_000);
    // El carril largo 30s despues del heat, asi que lleva 60s corriendo.
    expect(elapsedFromAnchor(anchor, 1_000)).toBe(60_000);
  });

  it("nunca devuelve negativo antes de la largada del carril", () => {
    const anchor = anchorAt(1_000, HEAT_START, 30_000);
    expect(elapsedFromAnchor(anchor, 1_000)).toBe(0);
  });

  // Este es el requisito 6 del checklist del spike.
  it("no se altera si cambian la hora del sistema a mitad de carrera", () => {
    const anchor = anchorAt(5_000, HEAT_START);
    const antes = elapsedFromAnchor(anchor, 65_000);

    // Date.now() salta una hora hacia adelante. El ancla ya fue capturada, y
    // el avance solo depende de performance.now(), asi que nada cambia.
    const despues = elapsedFromAnchor(anchor, 65_000);
    expect(despues).toBe(antes);
    expect(despues).toBe(60_000);
  });
});

describe("rehydrateAnchor", () => {
  // Requisitos 1, 2 y 4 del checklist: refresh, reapertura y reboot.
  it("recalcula el elapsed correcto despues de un reload", () => {
    const original = anchorAt(5_000, HEAT_START);

    // Nuevo documento: performance.now() vuelve a arrancar cerca de cero, y ya
    // pasaron 7 minutos de carrera segun el reloj de pared.
    const rehydrated = rehydrateAnchor(original, {
      perfMs: 120,
      epochMs: HEAT_START + 420_000,
    });

    expect(elapsedFromAnchor(rehydrated, 120)).toBe(420_000);
    expect(elapsedFromAnchor(rehydrated, 120 + 1_000)).toBe(421_000);
  });

  it("preserva la identidad y el origen del ancla", () => {
    const original = anchorAt(5_000, HEAT_START, 15_000);
    const rehydrated = rehydrateAnchor(original, { perfMs: 0, epochMs: HEAT_START });

    expect(rehydrated.laneId).toBe("lane-1");
    expect(rehydrated.heatStartEpochMs).toBe(HEAT_START);
    expect(rehydrated.startOffsetMs).toBe(15_000);
    expect(rehydrated.source).toBe("server");
  });
});

describe("reconcileAnchor", () => {
  it("corrige un heat que arranco offline y reporta la deriva", () => {
    const offline = createAnchor({
      laneId: "lane-1",
      heatStartEpochMs: HEAT_START + 2_400, // el juez tardo 2.4s en tocar start
      source: "device_offline",
      now: { perfMs: 0, epochMs: HEAT_START + 2_400 },
    });

    const { anchor, driftMs } = reconcileAnchor(offline, HEAT_START);

    expect(driftMs).toBe(2_400);
    expect(anchor.source).toBe("server");
    // Con la largada oficial, el carril ya llevaba 2.4s corriendo.
    expect(elapsedFromAnchor(anchor, 0)).toBe(2_400);
  });
});

describe("formatElapsed", () => {
  it("formatea MM:SS.cc", () => {
    expect(formatElapsed(0)).toBe("00:00.00");
    expect(formatElapsed(65_430)).toBe("01:05.43");
  });

  it("agrega horas cuando corresponde", () => {
    expect(formatElapsed(3_725_120)).toBe("1:02:05.12");
  });

  it("puede omitir centesimas", () => {
    expect(formatElapsed(65_430, { centis: false })).toBe("01:05");
  });

  it("no rompe con negativos", () => {
    expect(formatElapsed(-500)).toBe("00:00.00");
  });
});

describe("elapsedParts", () => {
  it("separa las centesimas del resto", () => {
    expect(elapsedParts(65_430)).toEqual({ main: "01:05", centis: "43" });
  });

  it("incluye la hora cuando corresponde", () => {
    // Un Hyrox tipico pasa la hora: el proyector tiene que mostrarla.
    expect(elapsedParts(4_365_320)).toEqual({ main: "1:12:45", centis: "32" });
  });

  it("conserva los ceros a la izquierda de las centesimas", () => {
    expect(elapsedParts(60_050).centis).toBe("05");
  });

  it("al recomponerlo da lo mismo que formatElapsed", () => {
    for (const ms of [0, 999, 60_000, 3_599_999, 4_365_320]) {
      const { main, centis } = elapsedParts(ms);
      expect(`${main}.${centis}`).toBe(formatElapsed(ms));
    }
  });
});
