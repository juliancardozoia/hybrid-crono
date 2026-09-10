import { describe, expect, it } from "vitest";
import {
  compararEntradasGenerales,
  compareTiebreakVectors,
  computeOverall,
  resolverTiebreaksDeOtraPrueba,
} from "./overall";
import { TABLA_TIEMPO_TOTAL, tablaDinamica } from "./points";

/** Una categoria de 40: el 1.o saca 100 y el 40.o cero. */
const TABLA_DE_40 = tablaDinamica(40);
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
    tiebreakPartId: null,
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

describe("el desempate que viene de otra prueba", () => {
  /** Igual que `parteReps`, pero con un `tiebreakPartId` explicito. */
  function parteConTiebreakDeOtra(id: string, tiebreakPartId: string | null): PartSpec {
    return { ...parteReps(id, 0), tiebreakPartId };
  }

  it("no toca nada si ninguna parte declara tiebreakPartId", () => {
    const parts = [parteReps("final", 0)];
    const scores = [reps("final", "c1", 100)];
    // Misma referencia de contenido, no la misma instancia: sigue siendo una
    // copia, para no compartir mutabilidad con el arreglo de entrada.
    expect(resolverTiebreaksDeOtraPrueba(parts, scores)).toEqual(scores);
  });

  it("usa el valor principal del equipo en la prueba de origen", () => {
    // "El desempate de la final es el tiempo de la clasificatoria."
    const parts = [parteConTiebreakDeOtra("final", "clasificatoria")];
    const scores = [
      reps("final", "c1", 50),
      reps("clasificatoria", "c1", 620_000),
    ];

    const resueltos = resolverTiebreaksDeOtraPrueba(parts, scores);
    const final = resueltos.find((s) => s.partId === "final" && s.teamId === "c1");
    expect(final?.tiebreak).toBe(620_000);
    // La prueba de origen no se toca: sigue siendo su propio score.
    const clasificatoria = resueltos.find((s) => s.partId === "clasificatoria");
    expect(clasificatoria?.tiebreak).toBeNull();
  });

  it("sin marca en la prueba de origen, no hay desempate — no es un error", () => {
    const parts = [parteConTiebreakDeOtra("final", "clasificatoria")];
    // El equipo corrio la final pero no la clasificatoria.
    const scores = [reps("final", "c1", 50)];

    const [final] = resolverTiebreaksDeOtraPrueba(parts, scores);
    expect(final.tiebreak).toBeNull();
  });

  it("un DNF en la prueba de origen tampoco da desempate", () => {
    // `value` solo esta poblado cuando el status es 'valido': un capeado o un
    // DNF en la clasificatoria no tienen un tiempo que prestarle a la final.
    const parts = [parteConTiebreakDeOtra("final", "clasificatoria")];
    const scores: RawScore[] = [
      reps("final", "c1", 50),
      { partId: "clasificatoria", teamId: "c1", status: "dnf", value: null, reps: null, capValue: null, tiebreak: null },
    ];

    const [final] = resolverTiebreaksDeOtraPrueba(parts, scores);
    expect(final.tiebreak).toBeNull();
  });

  it("cada equipo lee SU propio score en la prueba de origen", () => {
    const parts = [parteConTiebreakDeOtra("final", "clasificatoria")];
    const scores = [
      reps("final", "c1", 50),
      reps("final", "c2", 50),
      reps("clasificatoria", "c1", 600_000),
      reps("clasificatoria", "c2", 610_000),
    ];

    const resueltos = resolverTiebreaksDeOtraPrueba(parts, scores);
    expect(resueltos.find((s) => s.partId === "final" && s.teamId === "c1")?.tiebreak).toBe(
      600_000,
    );
    expect(resueltos.find((s) => s.partId === "final" && s.teamId === "c2")?.tiebreak).toBe(
      610_000,
    );
  });
});

describe("la tabla de puntos puede variar por parte", () => {
  // `tableFor` siempre soportó devolver una tabla distinta por parte —es la
  // firma que existe "para soportar la jerarquia evento -> categoria ->
  // prueba"—, pero hasta que `part_divisions.scoring_table_id` tuvo un
  // consumidor real, ningun test lo ejercia con algo que no fuera una
  // constante.
  it("cada parte usa la tabla que le corresponde, no una sola para todas", () => {
    const partes = [parteReps("e1", 0), parteReps("e2", 1)];
    const scores = [
      reps("e1", "a1", 100), reps("e1", "a2", 90),
      reps("e2", "a1", 100), reps("e2", "a2", 90),
    ];

    // e1 con CF-Open (los puntos son la posicion); e2 con una tabla de solo
    // dos valores, para que la diferencia sea imposible de confundir con una
    // coincidencia.
    const tablaEspecial: ScoringTable = {
      id: "t2",
      name: "Especial",
      points: [500, 200],
      dir: "mayor_gana",
      tiePolicy: "same_position_points",
    };

    const general = computeOverall({
      parts: partes,
      tableFor: (part) => (part.id === "e2" ? tablaEspecial : TABLA_TIEMPO_TOTAL),
      teamIds: ["a1", "a2"],
      scores,
    });

    const a1 = general.find((e) => e.teamId === "a1")!;
    const puntosE1 = a1.placements.find((p) => p.partId === "e1")!.points;
    const puntosE2 = a1.placements.find((p) => p.partId === "e2")!.points;

    expect(puntosE1).toBe(1); // CF-Open sin tabla: los puntos SON la posicion.
    expect(puntosE2).toBe(500); // La tabla especial de esa parte.
    expect(a1.totalPoints).toBe(501);
  });
});

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

describe("compararEntradasGenerales: el comparador COMPLETO, compartido por overall y scoreboard", () => {
  it("el mismo multiset de posiciones en orden distinto queda EMPATADO, no ordenado por cronologia", () => {
    // Dos equipos con placements [5,5,2,2] y [2,2,5,5] (mismas cuatro
    // posiciones, corridas en orden distinto) producen el MISMO
    // tiebreakVector una vez ordenado ascendente -- que es como lo construyen
    // computeOverall y buildScoreboard. El comparador tiene que verlos
    // empatados: no es un ranking por en que orden del evento salieron los
    // podios, es "quien tuvo mejores podios en conjunto".
    const a = { totalPoints: 14, tiebreakVector: [5, 5, 2, 2].sort((x, y) => x - y) };
    const b = { totalPoints: 14, tiebreakVector: [2, 2, 5, 5].sort((x, y) => x - y) };
    expect(compararEntradasGenerales("mayor_gana")(a, b)).toBe(0);
  });

  it("con totalPoints distintos, decide el total antes de mirar el vector", () => {
    const mejor = { totalPoints: 20, tiebreakVector: [3, 3] };
    const peor = { totalPoints: 14, tiebreakVector: [1, 1] };
    // mayor_gana: el de mas puntos va primero (numero negativo = "va antes").
    expect(compararEntradasGenerales("mayor_gana")(mejor, peor)).toBeLessThan(0);
    // menor_gana (carrera por tiempo): se invierte.
    expect(compararEntradasGenerales("menor_gana")(mejor, peor)).toBeGreaterThan(0);
  });

  it("con el vector identico, sigue empatado -- no hay tercer criterio", () => {
    const a = { totalPoints: 14, tiebreakVector: [1, 3, 4] };
    const b = { totalPoints: 14, tiebreakVector: [1, 3, 4] };
    expect(compararEntradasGenerales("mayor_gana")(a, b)).toBe(0);
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
    tableFor: siempre(TABLA_TIEMPO_TOTAL),
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
      tableFor: siempre(TABLA_TIEMPO_TOTAL),
      teamIds: equipos,
      scores,
    });
    expect(general[0].teamId).toBe("a");
    expect(general[0].totalPoints).toBe(2);
    expect(general[1].totalPoints).toBe(4);
  });

  it("con una tabla de puntos gana quien mas suma, con los mismos resultados", () => {
    // Mismo dataset, direccion invertida: el podio no puede cambiar de dueno
    // solo por como se reparten los puntos.
    const general = computeOverall({
      parts: partes,
      tableFor: siempre(TABLA_DE_40),
      teamIds: equipos,
      scores,
    });
    expect(general[0].teamId).toBe("a");
    // Dos primeros puestos contra dos segundos.
    expect(general[0].totalPoints).toBe(TABLA_DE_40.points[0] * 2);
    expect(general[1].totalPoints).toBe(TABLA_DE_40.points[1] * 2);
  });
});

describe("casos de borde", () => {
  it("dos equipos identicos en todo comparten posicion", () => {
    const general = computeOverall({
      parts: [parteReps("e1", 0)],
      tableFor: siempre(TABLA_TIEMPO_TOTAL),
      teamIds: ["a", "b"],
      scores: [reps("e1", "a", 100), reps("e1", "b", 100)],
    });
    expect(general.every((e) => e.position === 1)).toBe(true);
    expect(general.every((e) => e.tiedWith === 2)).toBe(true);
  });

  it("un evento sin pruebas devuelve el padron con cero puntos", () => {
    const general = computeOverall({
      parts: [],
      tableFor: siempre(TABLA_TIEMPO_TOTAL),
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
        tableFor: siempre(TABLA_TIEMPO_TOTAL),
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
      tiebreakPartId: null,
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
      tiebreakPartId: null,
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
