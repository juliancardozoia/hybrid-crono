import { describe, expect, it } from "vitest";
import { rankResults, reduceLaneEvents } from "./reducer";
import type { LaneResult, Segment, TimingEvent } from "./types";

const SEGMENTS: Segment[] = [
  { id: "s1", orderIndex: 0, kind: "run", name: "1km Run" },
  { id: "s2", orderIndex: 1, kind: "station", name: "SkiErg" },
  { id: "s3", orderIndex: 2, kind: "run", name: "1km Run" },
  { id: "s4", orderIndex: 3, kind: "station", name: "Sled Push" },
];

let seq = 0;
function ev(partial: Partial<TimingEvent> & { type: TimingEvent["type"] }): TimingEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    laneId: "lane-1",
    seq,
    segmentId: null,
    elapsedMs: 0,
    payload: {},
    recordedBy: "judge-1",
    deviceId: "dev-1",
    clientCapturedAt: 0,
    supersedesId: null,
    voided: false,
    voidReason: null,
    ...partial,
  };
}

function split(elapsedMs: number, id?: string): TimingEvent {
  return ev({ type: "segment_split", elapsedMs, ...(id ? { id } : {}) });
}

function penalty(
  elapsedMs: number,
  seconds: number,
  kind: "time_add" | "no_rep" | "dq" = "time_add",
): TimingEvent {
  return ev({
    type: "penalty",
    elapsedMs,
    payload: { code: "NO_REP", label: "Movimiento invalido", kind, seconds },
  });
}

const start = () => ev({ type: "lane_start", elapsedMs: 0 });

describe("reduceLaneEvents - estados", () => {
  it("sin eventos, el carril no arranco", () => {
    const r = reduceLaneEvents("lane-1", [], SEGMENTS);
    expect(r.status).toBe("not_started");
    expect(r.totalMs).toBeNull();
    expect(r.nextSegmentIndex).toBe(0);
  });

  it("con largada y splits parciales, esta corriendo", () => {
    const r = reduceLaneEvents("lane-1", [start(), split(300_000)], SEGMENTS);
    expect(r.status).toBe("running");
    expect(r.rawMs).toBeNull();
    expect(r.nextSegmentIndex).toBe(1);
  });

  it("con todos los segmentos marcados, termino", () => {
    const events = [start(), split(300_000), split(480_000), split(800_000), split(950_000)];
    const r = reduceLaneEvents("lane-1", events, SEGMENTS);
    expect(r.status).toBe("finished");
    expect(r.rawMs).toBe(950_000);
    expect(r.totalMs).toBe(950_000);
    expect(r.nextSegmentIndex).toBeNull();
  });

  it("ignora eventos de otro carril", () => {
    const otro = ev({ type: "segment_split", elapsedMs: 10_000, laneId: "lane-99" });
    const r = reduceLaneEvents("lane-1", [start(), otro], SEGMENTS);
    expect(r.splits).toHaveLength(0);
  });
});

describe("reduceLaneEvents - splits", () => {
  it("calcula la duracion de cada segmento por diferencia", () => {
    const events = [start(), split(300_000), split(480_000), split(800_000)];
    const r = reduceLaneEvents("lane-1", events, SEGMENTS);

    expect(r.splits.map((s) => s.durationMs)).toEqual([300_000, 180_000, 320_000]);
    expect(r.splits.map((s) => s.cumulativeMs)).toEqual([300_000, 480_000, 800_000]);
    expect(r.splits.map((s) => s.segmentName)).toEqual(["1km Run", "SkiErg", "1km Run"]);
  });

  it("marca como anomalia un split sospechosamente corto", () => {
    const r = reduceLaneEvents("lane-1", [start(), split(300_000), split(301_200)], SEGMENTS);
    expect(r.anomalies.map((a) => a.code)).toContain("split_too_fast");
    // Pero el dato se conserva: la anomalia se revisa, no se descarta sola.
    expect(r.splits).toHaveLength(2);
  });

  it("reordena por elapsed marcajes que llegaron desordenados", () => {
    const r = reduceLaneEvents(
      "lane-1",
      [
        start(),
        ev({ type: "segment_split", elapsedMs: 300_000 }),
        ev({ type: "segment_split", elapsedMs: 200_000 }),
      ],
      SEGMENTS,
    );
    expect(r.splits.map((s) => s.cumulativeMs)).toEqual([200_000, 300_000]);
  });

  it("reporta marcajes sobrantes sin romper el resultado", () => {
    const events = [
      start(),
      split(100_000),
      split(200_000),
      split(300_000),
      split(400_000),
      split(500_000),
    ];
    const r = reduceLaneEvents("lane-1", events, SEGMENTS);
    expect(r.anomalies.map((a) => a.code)).toContain("extra_splits");
    expect(r.splits).toHaveLength(4);
    expect(r.rawMs).toBe(400_000);
  });
});

describe("reduceLaneEvents - notas", () => {
  it("una nota no altera el tiempo ni cuenta como parcial", () => {
    const conNota = reduceLaneEvents(
      "lane-1",
      [start(), split(100_000), ev({ type: "note", elapsedMs: 120_000 }), split(200_000)],
      SEGMENTS,
    );
    const sinNota = reduceLaneEvents(
      "lane-1",
      [start(), split(100_000), split(200_000)],
      SEGMENTS,
    );

    expect(conNota.splits).toHaveLength(2);
    expect(conNota.splits.map((s) => s.cumulativeMs)).toEqual(
      sinNota.splits.map((s) => s.cumulativeMs),
    );
    expect(conNota.penaltyMs).toBe(0);
    expect(conNota.anomalies).toEqual([]);
  });
});

describe("reduceLaneEvents - correcciones (nada se borra)", () => {
  it("un undo anula el split al que apunta", () => {
    const bueno = split(300_000, "keep");
    const malo = split(302_000, "oops");
    const undo = ev({ type: "undo", elapsedMs: 302_500, supersedesId: "oops" });

    const r = reduceLaneEvents("lane-1", [start(), bueno, malo, undo], SEGMENTS);

    expect(r.splits).toHaveLength(1);
    expect(r.splits[0].cumulativeMs).toBe(300_000);
    expect(r.anomalies).toHaveLength(0);
  });

  it("una correccion reemplaza el marcaje original", () => {
    const original = split(300_000, "orig");
    const corregido = ev({
      type: "segment_split",
      elapsedMs: 295_000,
      id: "fix",
      supersedesId: "orig",
    });

    const r = reduceLaneEvents("lane-1", [start(), original, corregido], SEGMENTS);

    expect(r.splits).toHaveLength(1);
    expect(r.splits[0].cumulativeMs).toBe(295_000);
    expect(r.splits[0].eventId).toBe("fix");
  });

  it("soporta correcciones encadenadas", () => {
    const v1 = split(300_000, "v1");
    const v2 = ev({ type: "segment_split", elapsedMs: 295_000, id: "v2", supersedesId: "v1" });
    const v3 = ev({ type: "segment_split", elapsedMs: 290_000, id: "v3", supersedesId: "v2" });

    const r = reduceLaneEvents("lane-1", [start(), v1, v2, v3], SEGMENTS);

    expect(r.splits).toHaveLength(1);
    expect(r.splits[0].cumulativeMs).toBe(290_000);
  });

  it("un evento anulado por el organizador no cuenta", () => {
    const anulado = ev({
      type: "segment_split",
      elapsedMs: 300_000,
      voided: true,
      voidReason: "Marcaje del carril equivocado",
    });
    const r = reduceLaneEvents("lane-1", [start(), anulado], SEGMENTS);
    expect(r.splits).toHaveLength(0);
  });

  it("reporta un undo huerfano en vez de fallar", () => {
    const undo = ev({ type: "undo", elapsedMs: 10_000, supersedesId: "no-existe" });
    const r = reduceLaneEvents("lane-1", [start(), undo], SEGMENTS);
    expect(r.anomalies.map((a) => a.code)).toContain("orphan_undo");
  });
});

describe("reduceLaneEvents - penalizaciones", () => {
  const finish = () => [start(), split(100_000), split(200_000), split(300_000), split(400_000)];

  it("suma penalizaciones de tiempo al total", () => {
    const r = reduceLaneEvents("lane-1", [...finish(), penalty(150_000, 10)], SEGMENTS);
    expect(r.rawMs).toBe(400_000);
    expect(r.penaltyMs).toBe(10_000);
    expect(r.totalMs).toBe(410_000);
  });

  it("acumula varias penalizaciones", () => {
    const r = reduceLaneEvents(
      "lane-1",
      [...finish(), penalty(150_000, 10), penalty(250_000, 5), penalty(260_000, 15)],
      SEGMENTS,
    );
    expect(r.penaltyMs).toBe(30_000);
    expect(r.totalMs).toBe(430_000);
    expect(r.penalties).toHaveLength(3);
  });

  it("un no_rep no suma tiempo pero queda registrado", () => {
    const r = reduceLaneEvents("lane-1", [...finish(), penalty(150_000, 0, "no_rep")], SEGMENTS);
    expect(r.penaltyMs).toBe(0);
    expect(r.totalMs).toBe(400_000);
    expect(r.penalties).toHaveLength(1);
  });

  it("una penalizacion anulada no suma", () => {
    const p = penalty(150_000, 30);
    const undo = ev({ type: "undo", elapsedMs: 151_000, supersedesId: p.id });
    const r = reduceLaneEvents("lane-1", [...finish(), p, undo], SEGMENTS);
    expect(r.penaltyMs).toBe(0);
    expect(r.totalMs).toBe(400_000);
  });
});

describe("reduceLaneEvents - DNF y DQ", () => {
  it("DNF deja el carril sin tiempo", () => {
    const r = reduceLaneEvents(
      "lane-1",
      [start(), split(100_000), ev({ type: "dnf", elapsedMs: 250_000 })],
      SEGMENTS,
    );
    expect(r.status).toBe("dnf");
    expect(r.totalMs).toBeNull();
    expect(r.splits).toHaveLength(1); // lo que alcanzo a hacer se conserva
  });

  it("DQ manda aunque haya terminado", () => {
    const r = reduceLaneEvents(
      "lane-1",
      [
        start(),
        split(100_000),
        split(200_000),
        split(300_000),
        split(400_000),
        ev({ type: "dq", elapsedMs: 410_000 }),
      ],
      SEGMENTS,
    );
    expect(r.status).toBe("dq");
    expect(r.totalMs).toBeNull();
  });

  it("una penalizacion de tipo dq descalifica", () => {
    const r = reduceLaneEvents(
      "lane-1",
      [start(), split(100_000), penalty(120_000, 0, "dq")],
      SEGMENTS,
    );
    expect(r.status).toBe("dq");
  });
});


describe("reduceLaneEvents - reloj congelado", () => {
  it("un carril que termino se congela en la meta", () => {
    const r = reduceLaneEvents(
      "lane-1",
      [start(), split(100_000), split(200_000), split(300_000), split(400_000)],
      SEGMENTS,
    );
    expect(r.stoppedAtMs).toBe(400_000);
  });

  it("un DNF se congela en el momento del abandono, no en el ultimo parcial", () => {
    const r = reduceLaneEvents(
      "lane-1",
      [start(), split(100_000), ev({ type: "dnf", elapsedMs: 250_000 })],
      SEGMENTS,
    );
    expect(r.stoppedAtMs).toBe(250_000);
  });

  it("un DQ se congela en el momento de la descalificacion", () => {
    const r = reduceLaneEvents(
      "lane-1",
      [start(), split(100_000), ev({ type: "dq", elapsedMs: 180_000 })],
      SEGMENTS,
    );
    expect(r.stoppedAtMs).toBe(180_000);
  });

  it("un carril corriendo no tiene reloj congelado", () => {
    const r = reduceLaneEvents("lane-1", [start(), split(100_000)], SEGMENTS);
    expect(r.stoppedAtMs).toBeNull();
  });
});

describe("rankResults", () => {
  function result(laneId: string, over: Partial<LaneResult>): LaneResult {
    return {
      laneId,
      status: "finished",
      rawMs: null,
      penaltyMs: 0,
      totalMs: null,
      stoppedAtMs: null,
      splits: [],
      penalties: [],
      nextSegmentIndex: null,
      anomalies: [],
      ...over,
    };
  }

  it("gana el menor tiempo total", () => {
    const ranked = rankResults([
      result("c", { totalMs: 3_600_000 }),
      result("a", { totalMs: 3_400_000 }),
      result("b", { totalMs: 3_500_000 }),
    ]);
    expect(ranked.map((r) => r.laneId)).toEqual(["a", "b", "c"]);
  });

  it("las penalizaciones cambian el podio", () => {
    // "a" cruzo primero pero se comio 60s de penalizacion.
    const ranked = rankResults([
      result("a", { rawMs: 3_400_000, penaltyMs: 60_000, totalMs: 3_460_000 }),
      result("b", { rawMs: 3_450_000, totalMs: 3_450_000 }),
    ]);
    expect(ranked[0].laneId).toBe("b");
  });

  it("los que no terminaron van al fondo", () => {
    const ranked = rankResults([
      result("dq", { status: "dq" }),
      result("dnf", { status: "dnf" }),
      result("fin", { totalMs: 3_600_000 }),
    ]);
    expect(ranked.map((r) => r.laneId)).toEqual(["fin", "dnf", "dq"]);
  });

  it("entre dos corriendo, va adelante el que lleva mas segmentos", () => {
    const dosSplits = [{}, {}] as unknown as LaneResult["splits"];
    const tresSplits = [{}, {}, {}] as unknown as LaneResult["splits"];
    const ranked = rankResults([
      result("atras", { status: "running", splits: dosSplits }),
      result("adelante", { status: "running", splits: tresSplits }),
    ]);
    expect(ranked[0].laneId).toBe("adelante");
  });
});
