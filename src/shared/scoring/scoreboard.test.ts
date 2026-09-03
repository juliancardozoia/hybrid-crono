import { describe, expect, it } from "vitest";
import { buildScoreboard, type ScoreboardInput } from "./scoreboard";

function documento(parcial: Partial<ScoreboardInput> = {}): ScoreboardInput {
  return {
    version: 2,
    detalle: true,
    event: { name: "Copa Test", venue: null, status: "live", official: false },
    divisions: [
      { id: "d1", name: "RX Masculino", scoringTable: "cf_open", customPoints: [] },
    ],
    parts: [
      {
        id: "p1",
        workoutId: "w1",
        workoutName: "Evento 1",
        label: "",
        orderIndex: 0,
        scoreUnit: "reps",
        scoreDir: "mayor_gana",
        capUnit: null,
        tiebreakUnit: null,
        tiebreakDir: null,
      },
      {
        id: "p2",
        workoutId: "w2",
        workoutName: "Evento 2",
        label: "",
        orderIndex: 1000,
        scoreUnit: "tiempo",
        scoreDir: "menor_gana",
        capUnit: null,
        tiebreakUnit: null,
        tiebreakDir: null,
      },
    ],
    assignments: [
      { partId: "p1", divisionId: "d1" },
      { partId: "p2", divisionId: "d1" },
    ],
    teams: [
      { id: "t1", divisionId: "d1", bib: 101, name: null, athletes: "Ana Perez" },
      { id: "t2", divisionId: "d1", bib: 102, name: null, athletes: "Beto Gomez" },
    ],
    scores: [
      { partId: "p1", teamId: "t1", status: "valido", value: 150, reps: null, capValue: null, tiebreak: null },
      { partId: "p1", teamId: "t2", status: "valido", value: 120, reps: null, capValue: null, tiebreak: null },
      { partId: "p2", teamId: "t1", status: "valido", value: 400_000, reps: null, capValue: null, tiebreak: null },
      { partId: "p2", teamId: "t2", status: "valido", value: 300_000, reps: null, capValue: null, tiebreak: null },
    ],
    ...parcial,
  };
}

describe("buildScoreboard", () => {
  it("arma la tabla general de cada categoria", () => {
    const [categoria] = buildScoreboard(documento());

    expect(categoria.division.name).toBe("RX Masculino");
    expect(categoria.parts.map((p) => p.id)).toEqual(["p1", "p2"]);
    // t1 gana la de reps (1) y pierde la de tiempo (2) -> 3 puntos.
    // t2 al reves -> 3 puntos. Empatan y comparten posicion.
    expect(categoria.entries.map((e) => e.totalPoints)).toEqual([3, 3]);
    expect(categoria.entries.every((e) => e.position === 1)).toBe(true);
  });

  it("le pega el equipo a cada fila para que la pantalla no tenga que buscarlo", () => {
    const [categoria] = buildScoreboard(documento());
    expect(categoria.entries[0].team.bib).toBeGreaterThan(0);
    expect(categoria.entries[0].team.athletes).toBeTruthy();
  });

  it("ordena las pruebas de la categoria por su orden en el evento", () => {
    const doc = documento();
    // Llegan al reves de como se corren.
    doc.assignments = [
      { partId: "p2", divisionId: "d1" },
      { partId: "p1", divisionId: "d1" },
    ];
    const [categoria] = buildScoreboard(doc);
    expect(categoria.parts.map((p) => p.workoutName)).toEqual(["Evento 1", "Evento 2"]);
  });

  it("resuelve la tabla de puntos por su clave", () => {
    const doc = documento();
    doc.divisions = [
      { id: "d1", name: "Elite", scoringTable: "cf_games_40", customPoints: [] },
    ];
    const [categoria] = buildScoreboard(doc);
    // Con CF-Games gana quien mas suma: 100 del primero + 94 del segundo.
    expect(categoria.entries[0].totalPoints).toBe(194);
  });

  it("usa los puntos propios de una tabla personalizada", () => {
    const doc = documento();
    doc.divisions = [
      { id: "d1", name: "Final", scoringTable: "a-medida", customPoints: [50, 30] },
    ];
    const [categoria] = buildScoreboard(doc);
    expect(categoria.entries[0].totalPoints).toBe(80);
  });

  it("normaliza los numericos que la base puede mandar como texto", () => {
    // jsonb con numeric puede llegar como string segun el driver. Si no se
    // normaliza, el comparador ordena "1000" antes que "9" y el podio sale mal.
    const doc = documento();
    doc.scores = doc.scores.map((s) => ({
      ...s,
      value: String(s.value) as unknown as number,
    }));
    const [categoria] = buildScoreboard(doc);
    expect(categoria.entries.every((e) => Number.isFinite(e.totalPoints))).toBe(true);
    expect(categoria.entries[0].placements[0].position).toBeGreaterThan(0);
  });

  it("una categoria sin equipos no aparece", () => {
    const doc = documento();
    doc.teams = [];
    expect(buildScoreboard(doc)).toEqual([]);
  });

  it("un equipo sin score aparece igual, al fondo", () => {
    const doc = documento();
    doc.scores = doc.scores.filter((s) => s.teamId !== "t2");
    const [categoria] = buildScoreboard(doc);
    expect(categoria.entries).toHaveLength(2);
    expect(categoria.entries[0].teamId).toBe("t1");
  });

  it("un documento vacio no rompe", () => {
    expect(
      buildScoreboard({
        version: 2,
        detalle: false,
        event: { name: "", venue: null, status: "draft", official: false },
        divisions: [],
        parts: [],
        assignments: [],
        teams: [],
        scores: [],
      }),
    ).toEqual([]);
  });
});
