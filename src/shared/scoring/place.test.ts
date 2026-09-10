import { describe, expect, it } from "vitest";
import { assignPhysicalPositions, rankPart } from "./place";
import { TABLA_TIEMPO_TOTAL, tablaDinamica } from "./points";

/** Una categoria de 40: el 1.o saca 100 y el 40.o cero. */
const TABLA_DE_40 = tablaDinamica(40);
import type { PartSpec, RawScore } from "./types";

const POR_REPS: PartSpec = {
  id: "p1",
  orderIndex: 0,
  scoreUnit: "reps",
  scoreDir: "mayor_gana",
  capUnit: null,
  tiebreakUnit: null,
  tiebreakDir: null,
  tiebreakPartId: null,
};

function reps(teamId: string, value: number): RawScore {
  return {
    partId: "p1",
    teamId,
    status: "valido",
    value,
    reps: null,
    capValue: null,
    tiebreak: null,
  };
}

describe("assignPhysicalPositions", () => {
  it("sin empates, las posiciones son consecutivas", () => {
    const ubicados = assignPhysicalPositions([3, 1, 2], (a, b) => a - b);
    expect(ubicados.map((u) => [u.item, u.position])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("un triple empate en el tercero deja al siguiente en sexto, no en cuarto", () => {
    // El ejemplo literal del enunciado. La posicion es FISICA: cuantos tiene
    // por delante mas uno. El sexto tiene cinco adelante.
    const marcas = [250, 249, 230, 230, 230, 228, 225];
    const ubicados = assignPhysicalPositions(marcas, (a, b) => b - a);

    expect(ubicados.map((u) => u.position)).toEqual([1, 2, 3, 3, 3, 6, 7]);
    expect(ubicados.map((u) => u.item)).toEqual([250, 249, 230, 230, 230, 228, 225]);
  });

  it("informa cuantos comparten cada posicion", () => {
    const ubicados = assignPhysicalPositions([250, 230, 230, 230, 228], (a, b) => b - a);
    expect(ubicados.map((u) => u.tiedWith)).toEqual([1, 3, 3, 3, 1]);
  });

  it("todos empatados comparten el primer puesto", () => {
    const ubicados = assignPhysicalPositions([5, 5, 5], (a, b) => b - a);
    expect(ubicados.map((u) => u.position)).toEqual([1, 1, 1]);
  });

  it("no muta el arreglo original", () => {
    const original = [3, 1, 2];
    assignPhysicalPositions(original, (a, b) => a - b);
    expect(original).toEqual([3, 1, 2]);
  });

  it("una lista vacia no rompe", () => {
    expect(assignPhysicalPositions([], (a: number, b: number) => a - b)).toEqual([]);
  });
});

describe("rankPart", () => {
  it("rankea por marca y reparte los puntos de la tabla", () => {
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_DE_40,
      teamIds: ["a", "b", "c"],
      scores: [reps("a", 100), reps("b", 150), reps("c", 120)],
    });

    // Los valores salen de la tabla, no escritos a mano: lo que se prueba es
    // que cada puesto cobre LO QUE LA TABLA DICE para ese puesto.
    expect(placements.map((p) => [p.teamId, p.position, p.points])).toEqual([
      ["b", 1, TABLA_DE_40.points[0]],
      ["c", 2, TABLA_DE_40.points[1]],
      ["a", 3, TABLA_DE_40.points[2]],
    ]);
    expect(TABLA_DE_40.points[0]).toBe(100);
  });

  it("los empatados cobran los MISMOS puntos con la politica default (same_position_points)", () => {
    // Regla del reglamento de los Games: "more than one athlete can share a
    // workout rank, and each will earn the original point value". Es el
    // default; la convencion Scora que promedia se prueba aparte, mas abajo.
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_DE_40,
      teamIds: ["a", "b", "c", "d"],
      scores: [reps("a", 230), reps("b", 230), reps("c", 230), reps("d", 228)],
    });

    const empatados = placements.filter((p) => p.position === 3);
    expect(empatados).toHaveLength(0);

    // Los tres empatan en el primer puesto y cobran 100 cada uno.
    const primeros = placements.filter((p) => p.position === 1);
    expect(primeros).toHaveLength(3);
    expect(primeros.every((p) => p.points === 100)).toBe(true);

    // Y el cuarto queda en la posicion fisica 4, con los puntos del 4 — no
    // los del 2, que es lo que pasaria si el empate no corriera la posicion.
    const ultimo = placements.find((p) => p.teamId === "d");
    expect(ultimo?.position).toBe(4);
    expect(ultimo?.points).toBe(TABLA_DE_40.points[3]);
  });

  it("un equipo del padron sin score aparece igual, pendiente y al fondo", () => {
    // Sin esto no se puede responder "a quien le falta cargar", que es la
    // pantalla entera de la carga manual.
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_TIEMPO_TOTAL,
      teamIds: ["a", "b", "sin-marca"],
      scores: [reps("a", 100), reps("b", 90)],
    });

    const pendiente = placements.find((p) => p.teamId === "sin-marca");
    expect(pendiente?.status).toBe("pendiente");
    expect(pendiente?.position).toBe(3);
  });

  it("un equipo sin marca no cobra puntos de la curva, aunque comparta posicion con pocos rivales", () => {
    // Bug real: en una categoria de 10 con un solo finisher, los otros 9
    // quedaban EMPATADOS en la posicion 2 -- y la curva de Games en la
    // posicion 2 de un field de 10 vale ~92 puntos. Un atleta que nunca salio
    // a competir terminaba con casi el maximo del WOD.
    const placements = rankPart({
      part: POR_REPS,
      table: tablaDinamica(10),
      teamIds: ["ganador", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      scores: [reps("ganador", 100)],
    });

    const sinMarca = placements.filter((p) => p.teamId !== "ganador");
    expect(sinMarca.every((p) => p.status === "pendiente")).toBe(true);
    expect(sinMarca.every((p) => p.points === 0)).toBe(true);
    expect(placements.find((p) => p.teamId === "ganador")?.points).toBe(100);
  });

  it("conserva el valor crudo (sin normalizar) para que una pantalla lo muestre", () => {
    // El ranking sale siempre de `comparable`; `value`/`reps`/`capValue` son
    // solo para pintar "184 reps" o "08:21" en el detalle del atleta.
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_TIEMPO_TOTAL,
      teamIds: ["a", "sin-marca"],
      scores: [reps("a", 184)],
    });

    const a = placements.find((p) => p.teamId === "a");
    expect(a?.value).toBe(184);
    expect(a?.reps).toBeNull();
    expect(a?.capValue).toBeNull();

    const sinMarca = placements.find((p) => p.teamId === "sin-marca");
    expect(sinMarca?.value).toBeNull();
  });

  it("ignora scores de otra prueba", () => {
    const ajeno: RawScore = { ...reps("b", 999), partId: "otra" };
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_TIEMPO_TOTAL,
      teamIds: ["a", "b"],
      scores: [reps("a", 100), ajeno],
    });

    expect(placements[0].teamId).toBe("a");
    expect(placements.find((p) => p.teamId === "b")?.status).toBe("pendiente");
  });

  it("en CF-Open los puntos son la posicion", () => {
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_TIEMPO_TOTAL,
      teamIds: ["a", "b", "c"],
      scores: [reps("a", 100), reps("b", 150), reps("c", 120)],
    });
    expect(placements.map((p) => p.points)).toEqual([1, 2, 3]);
  });

  it("devuelve una fila por equipo del padron, ni una mas ni una menos", () => {
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_TIEMPO_TOTAL,
      teamIds: ["a", "b", "c", "d", "e"],
      scores: [reps("a", 10)],
    });
    expect(placements).toHaveLength(5);
    expect(new Set(placements.map((p) => p.teamId)).size).toBe(5);
  });
});

/**
 * El caso real que origino esta auditoria: 10 atletas, empates en 3, 5 y 9.
 * Posiciones fisicas 1,2,3,3,5,5,7,8,9,9 -- los puestos 4, 6 y 10 quedan
 * CONSUMIDOS, ninguna fila los tiene. Se corre con las dos politicas para
 * fijar que el default no cambia nada y que la convencion Scora reparte sin
 * inflar el total.
 */
describe("el caso real: 10 atletas con empates en 3, 5 y 9", () => {
  // Marcas por reps (mayor gana): dos pares empatados a proposito, y un
  // ultimo par en el fondo.
  const marcas: Array<[string, number]> = [
    ["a1", 100], // 1
    ["a2", 95], // 2
    ["a3", 90], // 3 (empate)
    ["a4", 90], // 3 (empate)
    ["a5", 80], // 5 (empate)
    ["a6", 80], // 5 (empate)
    ["a7", 70], // 7
    ["a8", 60], // 8
    ["a9", 50], // 9 (empate)
    ["a10", 50], // 9 (empate)
  ];
  const teamIds = marcas.map(([id]) => id);
  const scores = marcas.map(([id, value]) => reps(id, value));

  function rankearCon(tabla: ReturnType<typeof tablaDinamica>) {
    const placements = rankPart({ part: POR_REPS, table: tabla, teamIds, scores });
    const porTeam = new Map(placements.map((p) => [p.teamId, p]));
    return teamIds.map((id) => porTeam.get(id)!);
  }

  it("las posiciones fisicas son 1,2,3,3,5,5,7,8,9,9 con CUALQUIER politica", () => {
    for (const politica of ["same_position_points", "average_occupied_positions"] as const) {
      const tabla = tablaDinamica(10, 100, politica);
      const fila = rankearCon(tabla);
      expect(fila.map((p) => p.position)).toEqual([1, 2, 3, 3, 5, 5, 7, 8, 9, 9]);
    }
  });

  it("los puestos 4, 6 y 10 quedan consumidos: ninguna fila los tiene", () => {
    const fila = rankearCon(tablaDinamica(10));
    const posiciones = new Set(fila.map((p) => p.position));
    expect(posiciones.has(4)).toBe(false);
    expect(posiciones.has(6)).toBe(false);
    expect(posiciones.has(10)).toBe(false);
  });

  it("same_position_points (default): cada empatado cobra integro el puesto compartido", () => {
    const tabla = tablaDinamica(10, 100, "same_position_points");
    const fila = rankearCon(tabla);
    const puntos = fila.map((p) => p.points);

    expect(puntos[0]).toBeCloseTo(100, 3);
    expect(puntos[1]).toBeCloseTo(87.111, 3);
    expect(puntos[2]).toBeCloseTo(74.222, 3);
    expect(puntos[3]).toBeCloseTo(74.222, 3);
    expect(puntos[4]).toBeCloseTo(48.444, 3);
    expect(puntos[5]).toBeCloseTo(48.444, 3);
    expect(puntos[6]).toBeCloseTo(29, 3);
    expect(puntos[7]).toBeCloseTo(19.333, 3);
    expect(puntos[8]).toBeCloseTo(9.667, 3);
    expect(puntos[9]).toBeCloseTo(9.667, 3);

    // Infla el total por encima de lo que ofrece la curva -- es el
    // comportamiento oficial, documentado a proposito, no un bug.
    const total = puntos.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(490);
  });

  it("average_occupied_positions (Scora): reparte las posiciones ocupadas y ninguno saca 0", () => {
    const tabla = tablaDinamica(10, 100, "average_occupied_positions");
    const fila = rankearCon(tabla);
    const puntos = fila.map((p) => p.points);

    expect(puntos[0]).toBeCloseTo(100, 3);
    expect(puntos[1]).toBeCloseTo(87.111, 3);
    expect(puntos[2]).toBeCloseTo(67.778, 3); // (P3+P4)/2
    expect(puntos[3]).toBeCloseTo(67.778, 3);
    expect(puntos[4]).toBeCloseTo(43.556, 3); // (P5+P6)/2
    expect(puntos[5]).toBeCloseTo(43.556, 3);
    expect(puntos[6]).toBeCloseTo(29, 3);
    expect(puntos[7]).toBeCloseTo(19.333, 3);
    expect(puntos[8]).toBeCloseTo(4.834, 3); // (P9+P10)/2 -- ninguno saca 0
    expect(puntos[9]).toBeCloseTo(4.834, 3);

    for (const p of puntos) expect(p).toBeGreaterThan(0);
  });

  it("average_occupied_positions conserva el total repartido, hasta el redondeo", () => {
    const tabla = tablaDinamica(10, 100, "average_occupied_positions");
    const fila = rankearCon(tabla);
    const totalRepartido = fila.reduce((suma, p) => suma + p.points, 0);
    const totalCurva = tabla.points.reduce((a, b) => a + b, 0);
    expect(Math.abs(totalRepartido - totalCurva)).toBeLessThanOrEqual(0.001 * 10);
  });

  it("empate de 2 en primero: (P1+P2)/2, y el 3ro sigue siendo 3", () => {
    const dosEnPrimero: RawScore[] = [
      reps("a1", 100),
      reps("a2", 100),
      reps("a3", 90),
    ];
    const tabla = tablaDinamica(3, 100, "average_occupied_positions");
    const placements = rankPart({
      part: POR_REPS,
      table: tabla,
      teamIds: ["a1", "a2", "a3"],
      scores: dosEnPrimero,
    });
    const primero = placements.filter((p) => p.position === 1);
    expect(primero).toHaveLength(2);
    expect(primero[0].points).toBeCloseTo((tabla.points[0] + tabla.points[1]) / 2, 3);
    const tercero = placements.find((p) => p.teamId === "a3");
    expect(tercero?.position).toBe(3);
  });

  it("empate de 3: promedia tres posiciones y el siguiente es el 6to", () => {
    const tresEmpatados: RawScore[] = [
      reps("a1", 90),
      reps("a2", 90),
      reps("a3", 90),
      reps("a4", 80),
    ];
    const tabla = tablaDinamica(4, 100, "average_occupied_positions");
    const placements = rankPart({
      part: POR_REPS,
      table: tabla,
      teamIds: ["a1", "a2", "a3", "a4"],
      scores: tresEmpatados,
    });
    const empatados = placements.filter((p) => p.position === 1);
    expect(empatados).toHaveLength(3);
    const esperado = (tabla.points[0] + tabla.points[1] + tabla.points[2]) / 3;
    expect(empatados[0].points).toBeCloseTo(esperado, 3);
    const cuarto = placements.find((p) => p.teamId === "a4");
    expect(cuarto?.position).toBe(4);
  });

  it("empate en el ultimo puesto: el promedio incluye el 0 de la curva", () => {
    const tabla = tablaDinamica(4, 100, "average_occupied_positions");
    const placements = rankPart({
      part: POR_REPS,
      table: tabla,
      teamIds: ["a1", "a2", "a3", "a4"],
      scores: [reps("a1", 100), reps("a2", 90), reps("a3", 50), reps("a4", 50)],
    });
    const ultimos = placements.filter((p) => p.position === 3);
    expect(ultimos).toHaveLength(2);
    expect(ultimos[0].points).toBeCloseTo((tabla.points[2] + tabla.points[3]) / 2, 3);
  });

  it("un grupo empatado es HOMOGENEO: un dnf nunca empata con un valido", () => {
    const conDnf: RawScore[] = [
      { partId: "p1", teamId: "a1", status: "valido", value: 100, reps: null, capValue: null, tiebreak: null },
      { partId: "p1", teamId: "a2", status: "dnf", value: null, reps: null, capValue: null, tiebreak: null },
      { partId: "p1", teamId: "a3", status: "dnf", value: null, reps: null, capValue: null, tiebreak: null },
    ];
    const tabla = tablaDinamica(3, 100, "average_occupied_positions");
    const placements = rankPart({
      part: POR_REPS,
      table: tabla,
      teamIds: ["a1", "a2", "a3"],
      scores: conDnf,
    });
    const ganador = placements.find((p) => p.teamId === "a1")!;
    expect(ganador.points).toBeCloseTo(tabla.points[0], 3);

    // Los dos DNF empatan ENTRE SI (mismo statusRank, ambos sin value), pero
    // no cobran nada de la curva -- rankPart les da 0 antes de repartir.
    const dnfs = placements.filter((p) => p.status === "dnf");
    expect(dnfs).toHaveLength(2);
    expect(dnfs[0].position).toBe(dnfs[1].position);
    expect(dnfs.every((p) => p.points === 0)).toBe(true);
  });

  it("TABLA_TIEMPO_TOTAL nunca promedia: points sigue siendo la posicion entera", () => {
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_TIEMPO_TOTAL,
      teamIds: ["a1", "a2", "a3"],
      scores: [reps("a1", 90), reps("a2", 90), reps("a3", 80)],
    });
    const empatados = placements.filter((p) => p.position === 1);
    expect(empatados).toHaveLength(2);
    expect(empatados.every((p) => p.points === 1)).toBe(true); // points = position, sin promediar
  });
});
