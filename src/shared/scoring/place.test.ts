import { describe, expect, it } from "vitest";
import { assignPhysicalPositions, rankPart } from "./place";
import { TABLA_CF_GAMES_40, TABLA_CF_OPEN } from "./points";
import type { PartSpec, RawScore } from "./types";

const POR_REPS: PartSpec = {
  id: "p1",
  orderIndex: 0,
  scoreUnit: "reps",
  scoreDir: "mayor_gana",
  capUnit: null,
  tiebreakUnit: null,
  tiebreakDir: null,
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
      table: TABLA_CF_GAMES_40,
      teamIds: ["a", "b", "c"],
      scores: [reps("a", 100), reps("b", 150), reps("c", 120)],
    });

    expect(placements.map((p) => [p.teamId, p.position, p.points])).toEqual([
      ["b", 1, 100],
      ["c", 2, 94],
      ["a", 3, 88],
    ]);
  });

  it("los empatados cobran los MISMOS puntos, no el promedio", () => {
    // Regla del reglamento de los Games: "more than one athlete can share a
    // workout rank, and each will earn the original point value". Promediar
    // seria una invencion nuestra.
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_CF_GAMES_40,
      teamIds: ["a", "b", "c", "d"],
      scores: [reps("a", 230), reps("b", 230), reps("c", 230), reps("d", 228)],
    });

    const empatados = placements.filter((p) => p.position === 3);
    expect(empatados).toHaveLength(0);

    // Los tres empatan en el primer puesto y cobran 100 cada uno.
    const primeros = placements.filter((p) => p.position === 1);
    expect(primeros).toHaveLength(3);
    expect(primeros.every((p) => p.points === 100)).toBe(true);

    // Y el cuarto queda en la posicion fisica 4, con los puntos del 4.
    const ultimo = placements.find((p) => p.teamId === "d");
    expect(ultimo?.position).toBe(4);
    expect(ultimo?.points).toBe(84);
  });

  it("un equipo del padron sin score aparece igual, pendiente y al fondo", () => {
    // Sin esto no se puede responder "a quien le falta cargar", que es la
    // pantalla entera de la carga manual.
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_CF_OPEN,
      teamIds: ["a", "b", "sin-marca"],
      scores: [reps("a", 100), reps("b", 90)],
    });

    const pendiente = placements.find((p) => p.teamId === "sin-marca");
    expect(pendiente?.status).toBe("pendiente");
    expect(pendiente?.position).toBe(3);
  });

  it("ignora scores de otra prueba", () => {
    const ajeno: RawScore = { ...reps("b", 999), partId: "otra" };
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_CF_OPEN,
      teamIds: ["a", "b"],
      scores: [reps("a", 100), ajeno],
    });

    expect(placements[0].teamId).toBe("a");
    expect(placements.find((p) => p.teamId === "b")?.status).toBe("pendiente");
  });

  it("en CF-Open los puntos son la posicion", () => {
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_CF_OPEN,
      teamIds: ["a", "b", "c"],
      scores: [reps("a", 100), reps("b", 150), reps("c", 120)],
    });
    expect(placements.map((p) => p.points)).toEqual([1, 2, 3]);
  });

  it("devuelve una fila por equipo del padron, ni una mas ni una menos", () => {
    const placements = rankPart({
      part: POR_REPS,
      table: TABLA_CF_OPEN,
      teamIds: ["a", "b", "c", "d", "e"],
      scores: [reps("a", 10)],
    });
    expect(placements).toHaveLength(5);
    expect(new Set(placements.map((p) => p.teamId)).size).toBe(5);
  });
});
