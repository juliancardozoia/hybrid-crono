import { describe, expect, it } from "vitest";
import { scoreFromLaneResult, scoreFromWodResult } from "./fromTiming";
import type { WodResult } from "../timing/wod";
import { reduceLaneEvents } from "../timing/reducer";
import type { LaneResult, LaneStatus, Segment, TimingEvent } from "../timing/types";

function carril(parcial: Partial<LaneResult> = {}): LaneResult {
  return {
    laneId: "c1",
    status: "finished",
    rawMs: 3_600_000,
    penaltyMs: 0,
    totalMs: 3_600_000,
    stoppedAtMs: 3_600_000,
    splits: [],
    penalties: [],
    nextSegmentIndex: null,
    anomalies: [],
    ...parcial,
  };
}

describe("scoreFromLaneResult", () => {
  it("traduce los cinco estados del reductor", () => {
    const esperado: Array<[LaneStatus, string]> = [
      ["finished", "valido"],
      ["running", "en_curso"],
      ["not_started", "pendiente"],
      ["dnf", "dnf"],
      ["dq", "dq"],
    ];

    for (const [laneStatus, scoreStatus] of esperado) {
      const score = scoreFromLaneResult({
        partId: "p1",
        teamId: "t1",
        lane: carril({ status: laneStatus }),
      });
      expect(score.status).toBe(scoreStatus);
    }
  });

  it("el valor es el total del reductor, con las penalizaciones ya sumadas", () => {
    // No se recalcula nada aca: totalMs ya es rawMs + penaltyMs. Si esta
    // funcion volviera a sumar, las penalizaciones contarian dos veces.
    const score = scoreFromLaneResult({
      partId: "p1",
      teamId: "t1",
      lane: carril({ rawMs: 3_600_000, penaltyMs: 60_000, totalMs: 3_660_000 }),
    });
    expect(score.value).toBe(3_660_000);
  });

  it("un carril que no termino no tiene valor", () => {
    const score = scoreFromLaneResult({
      partId: "p1",
      teamId: "t1",
      lane: carril({ status: "dnf", rawMs: null, totalMs: null }),
    });
    expect(score.value).toBeNull();
  });

  it("un circuito nunca capea: o termina o es DNF", () => {
    const score = scoreFromLaneResult({ partId: "p1", teamId: "t1", lane: carril() });
    expect(score.capValue).toBeNull();
    expect(score.reps).toBeNull();
  });

  it("toma el desempate del acumulado al cerrar el segmento indicado", () => {
    const lane = carril({
      splits: [
        { segmentId: "s1", segmentName: "Run 1", orderIndex: 0, cumulativeMs: 240_000, durationMs: 240_000, eventId: "e1" },
        { segmentId: "s2", segmentName: "Sled", orderIndex: 1, cumulativeMs: 400_000, durationMs: 160_000, eventId: "e2" },
      ],
    });

    const score = scoreFromLaneResult({
      partId: "p1",
      teamId: "t1",
      lane,
      tiebreakSegmentId: "s2",
    });
    expect(score.tiebreak).toBe(400_000);
  });

  it("sin segmento de desempate declarado, no hay desempate", () => {
    const score = scoreFromLaneResult({ partId: "p1", teamId: "t1", lane: carril() });
    expect(score.tiebreak).toBeNull();
  });

  it("un segmento de desempate que no se marco deja el desempate vacio", () => {
    const score = scoreFromLaneResult({
      partId: "p1",
      teamId: "t1",
      lane: carril(),
      tiebreakSegmentId: "s9",
    });
    expect(score.tiebreak).toBeNull();
  });

  it("conserva la identidad de la parte y del equipo", () => {
    const score = scoreFromLaneResult({ partId: "p7", teamId: "t3", lane: carril() });
    expect(score.partId).toBe("p7");
    expect(score.teamId).toBe("t3");
  });
});

describe("de la punta al score", () => {
  /**
   * Recorre el camino real completo: marcajes del juez -> reductor -> score.
   * Es el que detecta que alguien cambio el contrato del reductor sin
   * acordarse de este puente.
   */
  const segmentos: Segment[] = [
    { id: "s1", orderIndex: 0, kind: "run", name: "Run 1" },
    { id: "s2", orderIndex: 1, kind: "station", name: "Sled Push" },
  ];

  function marcaje(parcial: Partial<TimingEvent>): TimingEvent {
    return {
      id: "x",
      laneId: "c1",
      seq: 1,
      type: "segment_split",
      segmentId: null,
      elapsedMs: 0,
      payload: {},
      recordedBy: "juez",
      deviceId: "d1",
      clientCapturedAt: 0,
      supersedesId: null,
      voided: false,
      voidReason: null,
      ...parcial,
    };
  }

  it("un circuito terminado con penalizacion llega al score con el tiempo penalizado", () => {
    const eventos: TimingEvent[] = [
      marcaje({ id: "e0", seq: 1, type: "lane_start", elapsedMs: 0 }),
      marcaje({ id: "e1", seq: 2, elapsedMs: 240_000 }),
      marcaje({ id: "e2", seq: 3, elapsedMs: 400_000 }),
      marcaje({
        id: "e3",
        seq: 4,
        type: "penalty",
        elapsedMs: 400_000,
        payload: { code: "NOREP", label: "No rep", kind: "time_add", seconds: 30 },
      }),
    ];

    const resultado = reduceLaneEvents("c1", eventos, segmentos);
    const score = scoreFromLaneResult({
      partId: "p1",
      teamId: "t1",
      lane: resultado,
      tiebreakSegmentId: "s1",
    });

    expect(score.status).toBe("valido");
    expect(score.value).toBe(430_000);
    expect(score.tiebreak).toBe(240_000);
  });
});

describe("scoreFromWodResult", () => {
  function wod(parcial: Partial<WodResult> = {}): WodResult {
    return {
      laneId: "c1",
      status: "finished",
      completedReps: 90,
      completedRounds: 3,
      repsInRound: 0,
      currentStepIndex: null,
      currentStepProgress: 0,
      finishedMs: 240_000,
      tiebreakMs: null,
      bestLiftKg: null,
      attempts: [],
      noRepCount: 0,
      capped: false,
      stoppedAtMs: 240_000,
      anomalies: [],
      ...parcial,
    };
  }

  it("una prueba por tiempo toma el tiempo de llegada", () => {
    const score = scoreFromWodResult({
      partId: "p1",
      teamId: "t1",
      wod: wod(),
      scoreUnit: "tiempo",
    });
    expect(score.status).toBe("valido");
    expect(score.value).toBe(240_000);
  });

  it("un AMRAP toma rondas y las reps de la parcial", () => {
    const score = scoreFromWodResult({
      partId: "p1",
      teamId: "t1",
      wod: wod({ completedRounds: 12, repsInRound: 7 }),
      scoreUnit: "rondas_reps",
    });
    expect(score.value).toBe(12);
    expect(score.reps).toBe(7);
  });

  it("una carga máxima toma el mejor intento válido", () => {
    const score = scoreFromWodResult({
      partId: "p1",
      teamId: "t1",
      wod: wod({ bestLiftKg: 102.5 }),
      scoreUnit: "carga",
    });
    expect(score.value).toBe(102.5);
  });

  it("reps, calorías y metros se cuentan igual: unidades hechas", () => {
    for (const unidad of ["reps", "calorias", "distancia"] as const) {
      const score = scoreFromWodResult({
        partId: "p1",
        teamId: "t1",
        wod: wod({ completedReps: 213 }),
        scoreUnit: unidad,
      });
      expect(score.value).toBe(213);
    }
  });

  it("quien capeó no tiene marca: rankea por lo que alcanzó a hacer", () => {
    const score = scoreFromWodResult({
      partId: "p1",
      teamId: "t1",
      wod: wod({ status: "running", capped: true, finishedMs: null, completedReps: 152 }),
      scoreUnit: "tiempo",
    });
    expect(score.status).toBe("capeado");
    expect(score.value).toBeNull();
    expect(score.capValue).toBe(152);
  });

  it("un DNF no deja marca aunque haya hecho repeticiones", () => {
    const score = scoreFromWodResult({
      partId: "p1",
      teamId: "t1",
      wod: wod({ status: "dnf", finishedMs: null, completedReps: 40 }),
      scoreUnit: "reps",
    });
    expect(score.status).toBe("dnf");
    expect(score.value).toBeNull();
  });

  it("arrastra el desempate del hito", () => {
    const score = scoreFromWodResult({
      partId: "p1",
      teamId: "t1",
      wod: wod({ tiebreakMs: 180_000 }),
      scoreUnit: "tiempo",
    });
    expect(score.tiebreak).toBe(180_000);
  });
});
