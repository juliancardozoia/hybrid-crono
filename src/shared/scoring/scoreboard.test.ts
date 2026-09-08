import { describe, expect, it } from "vitest";
import { buildScoreboard, type ScoreboardInput } from "./scoreboard";

function documento(parcial: Partial<ScoreboardInput> = {}): ScoreboardInput {
  return {
    version: 5,
    detalle: true,
    event: {
      name: "Copa Test",
      venue: null,
      status: "live",
      format: "crossfit",
      official: false,
    },
    divisions: [{ id: "d1", name: "RX Masculino" }],
    snapshots: [],
    stageAdvancements: [],
    parts: [
      {
        id: "p1",
        workoutId: "w1",
        workoutName: "Evento 1",
        label: "",
        orderIndex: 0,
        stage: 1,
        timeScheme: "rondas_reps",
        scoreUnit: "reps",
        scoreDir: "mayor_gana",
        capUnit: null,
        maxPoints: 100,
        tiebreakUnit: null,
        tiebreakDir: null,
        tiebreakPartId: null,
      },
      {
        id: "p2",
        workoutId: "w2",
        workoutName: "Evento 2",
        label: "",
        orderIndex: 1000,
        stage: 1,
        timeScheme: "cap",
        scoreUnit: "tiempo",
        scoreDir: "menor_gana",
        capUnit: null,
        maxPoints: 100,
        tiebreakUnit: null,
        tiebreakDir: null,
        tiebreakPartId: null,
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
    expect(categoria.stage).toBe(1);
    expect(categoria.parts.map((p) => p.id)).toEqual(["p1", "p2"]);
    // Cada uno gana una prueba: t1 la de reps, t2 la de tiempo. Con dos
    // atletas la curva es [100, 0], asi que los dos suman 100 y empatan.
    expect(categoria.entries.map((e) => e.totalPoints)).toEqual([100, 100]);
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

  it("sin snapshot, la curva se adapta al field que hay", () => {
    // Con dos atletas, ganar vale 100 y salir ultimo vale 0 — la escala
    // completa entre los dos, no un pedazo de una tabla de 40.
    const [categoria] = buildScoreboard(documento());
    const t1 = categoria.entries.find((e) => e.teamId === "t1")!;
    expect(t1.placements.find((p) => p.partId === "p1")!.points).toBe(100);
    expect(t1.placements.find((p) => p.partId === "p2")!.points).toBe(0);
  });

  it("con snapshot usa la curva congelada, no el field de hoy", () => {
    // LA garantia del snapshot: la tabla se congelo con 4 atletas y despues
    // se retiraron dos. Quedan 2 corriendo, pero el segundo NO cobra cero
    // (lo que le daria una curva de 2): cobra los 66,667 que la curva de 4 le
    // da al segundo puesto. Sin esto, retirarse le cambiaria los puntos a los
    // que se quedaron.
    const doc = documento();
    doc.snapshots = [{ divisionId: "d1", stage: 1, points: [100, 66.667, 33.333, 0], locked: true }];
    const [categoria] = buildScoreboard(doc);
    const t1 = categoria.entries.find((e) => e.teamId === "t1")!;
    expect(t1.placements.find((p) => p.partId === "p1")!.points).toBe(100);
    expect(t1.placements.find((p) => p.partId === "p2")!.points).toBe(66.667);
  });

  it("una carrera hibrida no reparte puntos: los puntos son la posicion", () => {
    const doc = documento();
    doc.event = { ...doc.event, format: "carrera_hibrida" };
    const [categoria] = buildScoreboard(doc);

    const t1 = categoria.entries.find((e) => e.teamId === "t1")!;
    // Gano la primera (1 punto) y perdio la segunda (2): suma 3, y gana quien
    // MENOS suma. Nada de la curva de Games entra aca.
    expect(t1.placements.map((p) => p.points)).toEqual([1, 2]);
    expect(t1.totalPoints).toBe(3);
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

  it("una prueba puede pesar mas que otra sin cambiar la curva", () => {
    // "El WOD final reparte el doble". Antes esto obligaba a crear una TABLA
    // entera para esa parte; ahora es un multiplicador sobre la misma curva,
    // que no se puede desincronizar de la de la categoria.
    const doc = documento();
    doc.parts = doc.parts.map((p) => (p.id === "p2" ? { ...p, maxPoints: 200 } : p));

    const [categoria] = buildScoreboard(doc);
    const t1 = categoria.entries.find((e) => e.teamId === "t1")!;
    const enP1 = t1.placements.find((p) => p.partId === "p1")!;
    const enP2 = t1.placements.find((p) => p.partId === "p2")!;

    // t1 gano p1 (150 reps > 120): 100 puntos.
    expect(enP1.points).toBe(100);
    // Y perdio p2 (400.000ms contra 300.000ms): ultimo de 2, cero — que
    // sigue siendo cero aunque la prueba valga el doble.
    expect(enP2.points).toBe(0);

    // El que gano p2 si cobra el doble.
    const t2 = categoria.entries.find((e) => e.teamId === "t2")!;
    expect(t2.placements.find((p) => p.partId === "p2")!.points).toBe(200);
  });

  it("el desempate de una parte puede venir de otra", () => {
    // "El desempate de la final es el tiempo de la clasificatoria."
    const doc = documento();
    // El unit/dir del desempate son obligatorios junto con tiebreakPartId —
    // mismo CHECK que ya exige la base (`parts_tiebreak_completo`)— y acá
    // corresponden al de la prueba de origen (p2 es "tiempo, menor gana").
    doc.parts[0] = { ...doc.parts[0], tiebreakUnit: "tiempo", tiebreakDir: "menor_gana", tiebreakPartId: "p2" };
    // Empatan en la parte que declara el desempate (p1).
    doc.scores = doc.scores.map((s) => (s.partId === "p1" ? { ...s, value: 150 } : s));

    const [categoria] = buildScoreboard(doc);
    const enP1 = (teamId: string) =>
      categoria.entries.find((e) => e.teamId === teamId)!.placements.find((p) => p.partId === "p1")!;

    // p2 es "menor gana": t2 hizo 300.000ms, mejor que t1 con 400.000ms.
    // Con p1 empatada 150-150, el desempate de p2 tiene que separarlos: t2
    // adelante.
    expect(enP1("t2").position).toBeLessThan(enP1("t1").position);
  });

  it("un documento vacio no rompe", () => {
    expect(
      buildScoreboard({
        version: 5,
        detalle: false,
        event: {
          name: "",
          venue: null,
          status: "draft",
          format: "crossfit",
          official: false,
        },
        divisions: [],
        snapshots: [],
        stageAdvancements: [],
        parts: [],
        assignments: [],
        teams: [],
        scores: [],
      }),
    ).toEqual([]);
  });

  describe("etapas y cortes", () => {
    // "Stage 1 con 40 -> cut -> Stage 2 con 20 -> cut -> Final".
    function documentoConEtapa2(): ScoreboardInput {
      const doc = documento();
      doc.parts.push({
        id: "p3",
        workoutId: "w3",
        workoutName: "Final",
        label: "",
        orderIndex: 2000,
        stage: 2,
        timeScheme: "rondas_reps",
        scoreUnit: "reps",
        scoreDir: "mayor_gana",
        capUnit: null,
        maxPoints: 100,
        tiebreakUnit: null,
        tiebreakDir: null,
        tiebreakPartId: null,
      });
      doc.assignments.push({ partId: "p3", divisionId: "d1" });
      doc.scores.push(
        { partId: "p3", teamId: "t1", status: "valido", value: 50, reps: null, capValue: null, tiebreak: null },
        { partId: "p3", teamId: "t2", status: "valido", value: 80, reps: null, capValue: null, tiebreak: null },
      );
      return doc;
    }

    it("la etapa 1 se muestra aunque todavia no haya ninguna prueba cargada (lista de largada)", () => {
      const doc = documento();
      doc.parts = [];
      doc.assignments = [];
      const [categoria] = buildScoreboard(doc);
      expect(categoria.stage).toBe(1);
      expect(categoria.entries.map((e) => e.teamId).sort()).toEqual(["t1", "t2"]);
    });

    it("sin corte confirmado, una etapa 2 con pruebas no aparece: nadie avanzo todavia", () => {
      const doc = documentoConEtapa2();
      const resultados = buildScoreboard(doc);
      expect(resultados.map((r) => r.stage)).toEqual([1]);
    });

    it("confirmado el corte, la etapa 2 solo rankea a quien avanzo", () => {
      const doc = documentoConEtapa2();
      // Solo t1 avanza -- t2 no, aunque haya cargado un score en la final.
      doc.stageAdvancements = [{ divisionId: "d1", stage: 2, teamId: "t1" }];

      const resultados = buildScoreboard(doc);
      const etapa2 = resultados.find((r) => r.stage === 2)!;

      expect(etapa2.entries.map((e) => e.teamId)).toEqual(["t1"]);
      // Etapa 1 sigue existiendo aparte, con los dos equipos.
      const etapa1 = resultados.find((r) => r.stage === 1)!;
      expect(etapa1.entries.map((e) => e.teamId).sort()).toEqual(["t1", "t2"]);
    });

    it("la etapa 2 usa su propia curva congelada, independiente de la etapa 1", () => {
      const doc = documentoConEtapa2();
      doc.stageAdvancements = [{ divisionId: "d1", stage: 2, teamId: "t1" }];
      doc.snapshots = [{ divisionId: "d1", stage: 2, points: [100, 40], locked: true }];

      const resultados = buildScoreboard(doc);
      const etapa2 = resultados.find((r) => r.stage === 2)!;
      // Con un solo equipo elegible, la curva congelada (2 puestos) igual
      // aplica su primer valor: la tabla no se recalcula al field de hoy.
      expect(etapa2.entries[0].placements[0].points).toBe(100);
    });
  });
});
