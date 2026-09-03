import { describe, expect, it } from "vitest";
import { compareTiebreakVectors, computeOverall } from "./overall";
import { TABLA_CF_GAMES_40, TABLA_CF_OPEN, TABLA_TIEMPO_TOTAL } from "./points";
import { scoreFromLaneResult } from "./fromTiming";
import { rankResults } from "../timing/reducer";
import type { LaneResult, LaneStatus } from "../timing/types";
import type { PartSpec, RawScore, ScoringTable } from "./types";

function parteReps(id: string, orderIndex: number): PartSpec {
  return {
    id,
    orderIndex,
    scoreUnit: "reps",
    scoreDir: "mayor_gana",
    capUnit: null,
    tiebreakUnit: null,
    tiebreakDir: null,
  };
}

function reps(partId: string, teamId: string, value: number): RawScore {
  return {
    partId,
    teamId,
    status: "valido",
    value,
    reps: null,
    capValue: null,
    tiebreak: null,
  };
}

const siempre = (tabla: ScoringTable) => () => tabla;

describe("compareTiebreakVectors", () => {
  it("gana quien tiene el mejor puesto en el primer indice donde difieren", () => {
    expect(compareTiebreakVectors([1, 2, 5, 6], [2, 2, 5, 5])).toBeLessThan(0);
  });

  it("si el primero empata, sigue con el siguiente", () => {
    expect(compareTiebreakVectors([2, 2, 5, 5], [2, 3, 4, 5])).toBeLessThan(0);
  });

  it("vectores identicos empatan de verdad", () => {
    // No se inventa un tercer criterio: el reglamento no lo tiene, y cualquiera
    // que inventaramos seria arbitrario.
    expect(compareTiebreakVectors([1, 3, 4], [1, 3, 4])).toBe(0);
  });
});

describe("la tabla general", () => {
  /**
   * El ejemplo del enunciado, con seis competidores para que las posiciones
   * lleguen hasta el sexto puesto. Las marcas estan elegidas para producir
   * exactamente estos puestos:
   *
   *   Atleta   Ev1  Ev2  Ev3  Ev4   Pts
   *   A1        1    1    2    4      8
   *   A2        4    4    1    1     10
   *   A3        1    2    5    6     14
   *   A4        5    5    2    2     14
   *   A5        3    2    4    5     14
   *   A6        6    6    6    3     21
   */
  const partes = [parteReps("e1", 0), parteReps("e2", 1), parteReps("e3", 2), parteReps("e4", 3)];
  const equipos = ["a1", "a2", "a3", "a4", "a5", "a6"];

  const scores: RawScore[] = [
    // Ev1: a1 y a3 empatan primeros, asi que el siguiente queda tercero.
    reps("e1", "a1", 100), reps("e1", "a3", 100), reps("e1", "a5", 90),
    reps("e1", "a2", 80), reps("e1", "a4", 70), reps("e1", "a6", 60),
    // Ev2: a3 y a5 empatan segundos, asi que el siguiente queda cuarto.
    reps("e2", "a1", 100), reps("e2", "a3", 90), reps("e2", "a5", 90),
    reps("e2", "a2", 80), reps("e2", "a4", 70), reps("e2", "a6", 60),
    // Ev3: a1 y a4 empatan segundos.
    reps("e3", "a2", 100), reps("e3", "a1", 90), reps("e3", "a4", 90),
    reps("e3", "a5", 80), reps("e3", "a3", 70), reps("e3", "a6", 60),
    // Ev4: sin empates.
    reps("e4", "a2", 100), reps("e4", "a4", 90), reps("e4", "a6", 85),
    reps("e4", "a1", 80), reps("e4", "a5", 70), reps("e4", "a3", 60),
  ];

  const general = computeOverall({
    parts: partes,
    tableFor: siempre(TABLA_CF_OPEN),
    teamIds: equipos,
    scores,
  });

  const porEquipo = new Map(general.map((e) => [e.teamId, e]));

  it("las marcas producen los puestos por prueba del enunciado", () => {
    const puestos = (teamId: string) =>
      porEquipo.get(teamId)!.placements.map((p) => p.position);

    expect(puestos("a1")).toEqual([1, 1, 2, 4]);
    expect(puestos("a2")).toEqual([4, 4, 1, 1]);
    expect(puestos("a3")).toEqual([1, 2, 5, 6]);
    expect(puestos("a4")).toEqual([5, 5, 2, 2]);
    expect(puestos("a5")).toEqual([3, 2, 4, 5]);
  });

  it("suma los puntos de cada prueba", () => {
    expect(porEquipo.get("a1")!.totalPoints).toBe(8);
    expect(porEquipo.get("a2")!.totalPoints).toBe(10);
    expect(porEquipo.get("a3")!.totalPoints).toBe(14);
    expect(porEquipo.get("a4")!.totalPoints).toBe(14);
    expect(porEquipo.get("a5")!.totalPoints).toBe(14);
  });

  it("resuelve el triple empate en 14 puntos por mejores podios", () => {
    // a3 va tercero porque tuvo un primer puesto y los otros no.
    // a4 va cuarto porque tuvo dos segundos y a5 tuvo uno solo.
    expect(general.map((e) => e.teamId)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
    expect(porEquipo.get("a3")!.position).toBe(3);
    expect(porEquipo.get("a4")!.position).toBe(4);
    expect(porEquipo.get("a5")!.position).toBe(5);
  });

  it("el vector de desempate son las posiciones ordenadas de mejor a peor", () => {
    expect(porEquipo.get("a3")!.tiebreakVector).toEqual([1, 2, 5, 6]);
    expect(porEquipo.get("a4")!.tiebreakVector).toEqual([2, 2, 5, 5]);
    expect(porEquipo.get("a5")!.tiebreakVector).toEqual([2, 3, 4, 5]);
  });

  it("los tres empatados en puntos NO comparten posicion, porque el desempate los separo", () => {
    expect(porEquipo.get("a3")!.tiedWith).toBe(1);
    expect(porEquipo.get("a4")!.tiedWith).toBe(1);
    expect(porEquipo.get("a5")!.tiedWith).toBe(1);
  });

  it("las pruebas salen en el orden del evento, no en el que se rankearon", () => {
    expect(porEquipo.get("a1")!.placements.map((p) => p.partId)).toEqual([
      "e1",
      "e2",
      "e3",
      "e4",
    ]);
  });
});

describe("la direccion de la suma", () => {
  const partes = [parteReps("e1", 0), parteReps("e2", 1)];
  const equipos = ["a", "b"];
  const scores = [
    reps("e1", "a", 100), reps("e1", "b", 90),
    reps("e2", "a", 100), reps("e2", "b", 90),
  ];

  it("en CF-Open gana quien menos suma", () => {
    const general = computeOverall({
      parts: partes,
      tableFor: siempre(TABLA_CF_OPEN),
      teamIds: equipos,
      scores,
    });
    expect(general[0].teamId).toBe("a");
    expect(general[0].totalPoints).toBe(2);
    expect(general[1].totalPoints).toBe(4);
  });

  it("en CF-Games gana quien mas suma, con los mismos resultados", () => {
    // Mismo dataset, tabla invertida: el podio no puede cambiar de dueno solo
    // por como se reparten los puntos.
    const general = computeOverall({
      parts: partes,
      tableFor: siempre(TABLA_CF_GAMES_40),
      teamIds: equipos,
      scores,
    });
    expect(general[0].teamId).toBe("a");
    expect(general[0].totalPoints).toBe(200);
    expect(general[1].totalPoints).toBe(188);
  });
});

describe("casos de borde", () => {
  it("dos equipos identicos en todo comparten posicion", () => {
    const general = computeOverall({
      parts: [parteReps("e1", 0)],
      tableFor: siempre(TABLA_CF_OPEN),
      teamIds: ["a", "b"],
      scores: [reps("e1", "a", 100), reps("e1", "b", 100)],
    });
    expect(general.every((e) => e.position === 1)).toBe(true);
    expect(general.every((e) => e.tiedWith === 2)).toBe(true);
  });

  it("un evento sin pruebas devuelve el padron con cero puntos", () => {
    const general = computeOverall({
      parts: [],
      tableFor: siempre(TABLA_CF_OPEN),
      teamIds: ["a", "b"],
      scores: [],
    });
    expect(general).toHaveLength(2);
    expect(general.every((e) => e.totalPoints === 0)).toBe(true);
  });

  it("un padron vacio devuelve una tabla vacia", () => {
    expect(
      computeOverall({
        parts: [parteReps("e1", 0)],
        tableFor: siempre(TABLA_CF_OPEN),
        teamIds: [],
        scores: [],
      }),
    ).toEqual([]);
  });
});

/**
 * La prueba que amarra los dos formatos.
 *
 * Un evento de una sola prueba por tiempo tiene que producir el MISMO podio por
 * el motor de puntuacion que por `rankResults` del reductor de circuitos. Si
 * alguna vez divergen, un Hyrox mostraria un orden en la pantalla del juez y
 * otro en el leaderboard.
 */
describe("equivalencia con el ranking de circuitos", () => {
  function carril(laneId: string, status: LaneStatus, totalMs: number | null): LaneResult {
    return {
      laneId,
      status,
      rawMs: totalMs,
      penaltyMs: 0,
      totalMs,
      stoppedAtMs: totalMs,
      splits: [],
      penalties: [],
      nextSegmentIndex: null,
      anomalies: [],
    };
  }

  it("una sola prueba por tiempo da el mismo orden que rankResults", () => {
    const carriles = [
      carril("c1", "finished", 3_600_000),
      carril("c2", "finished", 3_300_000),
      carril("c3", "dq", null),
      carril("c4", "finished", 3_450_000),
      carril("c5", "dnf", null),
    ];

    const esperado = rankResults(carriles).map((r) => r.laneId);

    const parte: PartSpec = {
      id: "circuito",
      orderIndex: 0,
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
      capUnit: null,
      tiebreakUnit: null,
      tiebreakDir: null,
    };

    const general = computeOverall({
      parts: [parte],
      tableFor: siempre(TABLA_TIEMPO_TOTAL),
      teamIds: carriles.map((c) => c.laneId),
      scores: carriles.map((lane) =>
        scoreFromLaneResult({ partId: "circuito", teamId: lane.laneId, lane }),
      ),
    });

    expect(general.map((e) => e.teamId)).toEqual(esperado);
  });

  it("con una sola prueba, los puntos son directamente la posicion", () => {
    const parte: PartSpec = {
      id: "circuito",
      orderIndex: 0,
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
      capUnit: null,
      tiebreakUnit: null,
      tiebreakDir: null,
    };

    const general = computeOverall({
      parts: [parte],
      tableFor: siempre(TABLA_TIEMPO_TOTAL),
      teamIds: ["c1", "c2"],
      scores: [
        scoreFromLaneResult({
          partId: "circuito",
          teamId: "c1",
          lane: carril("c1", "finished", 3_600_000),
        }),
        scoreFromLaneResult({
          partId: "circuito",
          teamId: "c2",
          lane: carril("c2", "finished", 3_300_000),
        }),
      ],
    });

    expect(general.map((e) => [e.teamId, e.position, e.totalPoints])).toEqual([
      ["c2", 1, 1],
      ["c1", 2, 2],
    ]);
  });
});
