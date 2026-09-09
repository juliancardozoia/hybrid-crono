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

    it("la etapa 2 usa su propia curva congelada para SU parte, sin tocar la de la etapa 1", () => {
      const doc = documentoConEtapa2();
      doc.stageAdvancements = [{ divisionId: "d1", stage: 2, teamId: "t1" }];
      doc.snapshots = [
        { divisionId: "d1", stage: 1, points: [100, 0], locked: true },
        { divisionId: "d1", stage: 2, points: [100, 40], locked: true },
      ];

      const resultados = buildScoreboard(doc);
      const etapa2 = resultados.find((r) => r.stage === 2)!;
      const t1 = etapa2.entries.find((e) => e.teamId === "t1")!;

      // La parte p3 (etapa 2, un solo elegible) usa la curva congelada de la
      // etapa 2: primer puesto de esa curva son 100 puntos.
      expect(t1.placements.find((p) => p.partId === "p3")!.points).toBe(100);
      // Las partes p1/p2 (etapa 1, dos equipos) siguen valorandose con LA
      // CURVA DE LA ETAPA 1 -- nunca se recalculan con la de la final.
      expect(t1.placements.find((p) => p.partId === "p1")!.points).toBe(100);
      expect(t1.placements.find((p) => p.partId === "p2")!.points).toBe(0);
    });

    it("un corte NUNCA reinicia los puntos: la etapa 2 acumula lo de la etapa 1", () => {
      // Con la base de "documento()": t1 gana p1 (100) y pierde p2 (0); t2 al
      // reves -- p1(0) y p2(100). Entran EMPATADOS a la final con 100 cada
      // uno (mismo caso que el primer test del archivo).
      const doc = documentoConEtapa2();
      // Los dos avanzan a la final.
      doc.stageAdvancements = [
        { divisionId: "d1", stage: 2, teamId: "t1" },
        { divisionId: "d1", stage: 2, teamId: "t2" },
      ];

      const resultados = buildScoreboard(doc);
      const etapa1 = resultados.find((r) => r.stage === 1)!;
      const etapa2 = resultados.find((r) => r.stage === 2)!;

      const totalEtapa1 = (id: string) => etapa1.entries.find((e) => e.teamId === id)!.totalPoints;
      const totalEtapa2 = (id: string) => etapa2.entries.find((e) => e.teamId === id)!.totalPoints;

      // La vista de la final trae los 3 WODs (p1, p2 de la etapa 1 + p3 de la
      // final), no solo p3.
      expect(etapa2.parts.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);

      expect(totalEtapa1("t1")).toBe(100);
      expect(totalEtapa1("t2")).toBe(100);

      // En la final (curva dinamica de 2, [100, 0]) t2 gana p3 (80 > 50
      // reps): se lleva 100 puntos MAS, no en vez de, los 100 que ya traia.
      // t1 pierde p3: sigue con exactamente los 100 que ya tenia, nunca baja
      // a cero. El resultado de la final NO borra lo anterior, se le suma.
      expect(totalEtapa2("t1")).toBe(totalEtapa1("t1") + 0);
      expect(totalEtapa2("t2")).toBe(totalEtapa1("t2") + 100);
      expect(totalEtapa2("t1")).toBe(100);
      expect(totalEtapa2("t2")).toBe(200);

      // Ganar la final alcanza para pasar al frente (t2 sube de empatado en
      // el 1 a unico primero), pero SOLO porque el acumulado lo respalda --
      // no por haber ganado la ultima prueba en si misma.
      const t1Final = etapa2.entries.find((e) => e.teamId === "t1")!;
      const t2Final = etapa2.entries.find((e) => e.teamId === "t2")!;
      expect(t2Final.position).toBe(1);
      expect(t1Final.position).toBe(2);
    });

    it("los eliminados por el corte conservan su clasificacion en la etapa donde quedaron", () => {
      // t1 gana LAS DOS pruebas de la etapa 1 (se fuerza que tambien gane p2,
      // que en la base pierde) para que el corte no sea un empate: t1=200,
      // t2=0, sin ambiguedad de a quien le toca avanzar.
      const doc = documentoConEtapa2();
      doc.scores = doc.scores.map((s) =>
        s.partId === "p2" && s.teamId === "t1" ? { ...s, value: 200_000 } : s,
      );
      doc.stageAdvancements = [{ divisionId: "d1", stage: 2, teamId: "t1" }];

      const resultados = buildScoreboard(doc);
      const etapa1 = resultados.find((r) => r.stage === 1)!;
      const etapa2 = resultados.find((r) => r.stage === 2)!;

      const t1EnEtapa1 = etapa1.entries.find((e) => e.teamId === "t1")!;
      const t2EnEtapa1 = etapa1.entries.find((e) => e.teamId === "t2")!;
      // El eliminado conserva su resultado real y su posicion, no desaparece
      // ni queda en cero por no haber avanzado.
      expect(t1EnEtapa1.totalPoints).toBe(200);
      expect(t1EnEtapa1.position).toBe(1);
      expect(t2EnEtapa1.totalPoints).toBe(0);
      expect(t2EnEtapa1.position).toBe(2);
      // Pero no participa de ningun WOD posterior al corte.
      expect(etapa2.entries.some((e) => e.teamId === "t2")).toBe(false);
    });

    it("dos cortes: el acumulado de la final suma las TRES etapas, no solo la ultima", () => {
      // 4 atletas -> corte a 3 -> corte a 2 -> final entre 2.
      const doc: ScoreboardInput = {
        version: 5,
        detalle: true,
        event: { name: "Copa Test", venue: null, status: "live", format: "crossfit", official: false },
        divisions: [{ id: "d1", name: "RX Masculino" }],
        teams: [
          { id: "t1", divisionId: "d1", bib: 1, name: null, athletes: "T1" },
          { id: "t2", divisionId: "d1", bib: 2, name: null, athletes: "T2" },
          { id: "t3", divisionId: "d1", bib: 3, name: null, athletes: "T3" },
          { id: "t4", divisionId: "d1", bib: 4, name: null, athletes: "T4" },
        ],
        parts: [
          {
            id: "p1", workoutId: "w1", workoutName: "WOD 1", label: "", orderIndex: 0, stage: 1,
            timeScheme: "rondas_reps", scoreUnit: "reps", scoreDir: "mayor_gana", capUnit: null,
            maxPoints: 100, tiebreakUnit: null, tiebreakDir: null, tiebreakPartId: null,
          },
          {
            id: "p2", workoutId: "w2", workoutName: "WOD 2", label: "", orderIndex: 1000, stage: 2,
            timeScheme: "rondas_reps", scoreUnit: "reps", scoreDir: "mayor_gana", capUnit: null,
            maxPoints: 100, tiebreakUnit: null, tiebreakDir: null, tiebreakPartId: null,
          },
          {
            id: "p3", workoutId: "w3", workoutName: "Final", label: "", orderIndex: 2000, stage: 3,
            timeScheme: "rondas_reps", scoreUnit: "reps", scoreDir: "mayor_gana", capUnit: null,
            maxPoints: 100, tiebreakUnit: null, tiebreakDir: null, tiebreakPartId: null,
          },
        ],
        assignments: [
          { partId: "p1", divisionId: "d1" },
          { partId: "p2", divisionId: "d1" },
          { partId: "p3", divisionId: "d1" },
        ],
        scores: [
          // WOD 1 (los 4): t1 1ro, t2 2do, t3 3ro, t4 4to (ultimo, eliminado).
          { partId: "p1", teamId: "t1", status: "valido", value: 400, reps: null, capValue: null, tiebreak: null },
          { partId: "p1", teamId: "t2", status: "valido", value: 300, reps: null, capValue: null, tiebreak: null },
          { partId: "p1", teamId: "t3", status: "valido", value: 200, reps: null, capValue: null, tiebreak: null },
          { partId: "p1", teamId: "t4", status: "valido", value: 100, reps: null, capValue: null, tiebreak: null },
          // WOD 2 (top 3): se invierte -- t3 gana, t2 2do, t1 ultimo.
          { partId: "p2", teamId: "t3", status: "valido", value: 500, reps: null, capValue: null, tiebreak: null },
          { partId: "p2", teamId: "t2", status: "valido", value: 300, reps: null, capValue: null, tiebreak: null },
          { partId: "p2", teamId: "t1", status: "valido", value: 100, reps: null, capValue: null, tiebreak: null },
          // Final (top 2, t2 y t3): t2 gana grande.
          { partId: "p3", teamId: "t2", status: "valido", value: 600, reps: null, capValue: null, tiebreak: null },
          { partId: "p3", teamId: "t3", status: "valido", value: 100, reps: null, capValue: null, tiebreak: null },
        ],
        snapshots: [
          { divisionId: "d1", stage: 1, points: [100, 70, 40, 0], locked: true },
          { divisionId: "d1", stage: 2, points: [100, 50, 0], locked: true },
          { divisionId: "d1", stage: 3, points: [100, 0], locked: true },
        ],
        stageAdvancements: [
          // Corte 1: top 3 (t1, t2, t3). t4 queda afuera.
          { divisionId: "d1", stage: 2, teamId: "t1" },
          { divisionId: "d1", stage: 2, teamId: "t2" },
          { divisionId: "d1", stage: 2, teamId: "t3" },
          // Corte 2: top 2 (t2, t3). t1 queda afuera.
          { divisionId: "d1", stage: 3, teamId: "t2" },
          { divisionId: "d1", stage: 3, teamId: "t3" },
        ],
      };

      const resultados = buildScoreboard(doc);
      const etapa1 = resultados.find((r) => r.stage === 1)!;
      const etapa2 = resultados.find((r) => r.stage === 2)!;
      const etapa3 = resultados.find((r) => r.stage === 3)!;

      const total = (etapa: typeof etapa1, id: string) =>
        etapa.entries.find((e) => e.teamId === id)?.totalPoints;

      // Etapa 1: los 4, con la curva congelada de la etapa 1.
      expect(total(etapa1, "t1")).toBe(100);
      expect(total(etapa1, "t2")).toBe(70);
      expect(total(etapa1, "t3")).toBe(40);
      expect(total(etapa1, "t4")).toBe(0);

      // Etapa 2: solo t1,t2,t3, y el WOD 1 sigue valiendo lo que valio (no se
      // recalcula con la curva de 3). t3 dio vuelta el WOD 2: 40+100=140.
      expect(etapa2.entries.map((e) => e.teamId).sort()).toEqual(["t1", "t2", "t3"]);
      expect(total(etapa2, "t1")).toBe(100 + 0);
      expect(total(etapa2, "t2")).toBe(70 + 50);
      expect(total(etapa2, "t3")).toBe(40 + 100);

      // Etapa 3 (final): solo t2 y t3 -- t1 quedo eliminado en el segundo
      // corte y NO aparece aca, pero su fila de la etapa 2 (100 puntos,
      // 3er puesto) sigue existiendo y consultable.
      expect(etapa3.entries.map((e) => e.teamId).sort()).toEqual(["t2", "t3"]);
      expect(total(etapa2, "t1")).toBe(100);
      const t1EnEtapa2 = etapa2.entries.find((e) => e.teamId === "t1")!;
      expect(t1EnEtapa2.position).toBe(3);

      // El acumulado final SUMA LAS TRES etapas: 70 (WOD1) + 50 (WOD2) + 100
      // (final) para t2, y 40 + 100 + 0 para t3. t2 entraba segundo a la
      // final (120 contra 140) pero gana la final por margen suficiente para
      // dar vuelta el resultado -- no porque "ganar la final" alcance solo.
      expect(total(etapa3, "t2")).toBe(70 + 50 + 100);
      expect(total(etapa3, "t3")).toBe(40 + 100 + 0);
      expect(total(etapa3, "t2")).toBe(220);
      expect(total(etapa3, "t3")).toBe(140);

      const t2Final = etapa3.entries.find((e) => e.teamId === "t2")!;
      const t3Final = etapa3.entries.find((e) => e.teamId === "t3")!;
      expect(t2Final.position).toBe(1);
      expect(t3Final.position).toBe(2);
    });
  });
});
