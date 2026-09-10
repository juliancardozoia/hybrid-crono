// @vitest-environment jsdom

/**
 * "3 rondas + 10 reps" no dice si esas 10 son de un movimiento completo o de
 * uno a medias -- reportado como confuso. Cuando el score trae
 * `roundBreakdown` (ver src/shared/timing/wod.ts), el detalle del atleta
 * tiene que mostrar el desglose movimiento por movimiento en vez del total
 * ambiguo.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "../../../../test/render";
import { TablaGeneral } from "./TablaGeneral";
import type { TablaGeneral as Datos } from "../queries";
import type { ScoreboardPart } from "@/shared/scoring/scoreboard";
import type { OverallEntry } from "@/shared/scoring/types";

vi.mock("../queries", () => ({
  getTablaGeneral: vi.fn(async () => ({
    divisiones: [],
    cantidadDePruebas: 0,
    soloCircuito: false,
    official: false,
    updatedAt: 0,
  })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PARTE: ScoreboardPart = {
  id: "p1",
  workoutId: "w1",
  workoutName: "Cindy",
  label: "",
  orderIndex: 0,
  stage: 1,
  timeScheme: "ventana",
  scoreUnit: "rondas_reps",
  scoreDir: "mayor_gana",
  capUnit: null,
  maxPoints: 100,
  tiebreakUnit: null,
  tiebreakDir: null,
  tiebreakPartId: null,
};

function entrada(over: Partial<OverallEntry> = {}): OverallEntry {
  return {
    teamId: "t1",
    totalPoints: 50,
    displayPoints: 50,
    tiebreakVector: [1],
    position: 1,
    tiedWith: 1,
    placements: [
      {
        partId: "p1",
        teamId: "t1",
        status: "valido",
        position: 1,
        tiedWith: 1,
        points: 50,
        comparable: { statusRank: 0, value: 11, tiebreak: null },
        value: 3,
        reps: 11,
        capValue: null,
        roundBreakdown: [
          { name: "Pull-up", unit: "reps", target: 5, done: 5, completo: true },
          { name: "Push-up", unit: "reps", target: 10, done: 6, completo: false },
          { name: "Air Squat", unit: "reps", target: 15, done: 0, completo: false },
        ],
      },
    ],
    ...over,
  };
}

function datos(entradas: OverallEntry[]): Datos {
  return {
    divisiones: [
      {
        division: { id: "d1", name: "Rx" },
        stage: 1,
        parts: [PARTE],
        entries: entradas.map((e) => ({
          ...e,
          team: {
            id: e.teamId,
            divisionId: "d1",
            bib: 101,
            name: null,
            athletes: "Ana Perez",
            countries: [],
          },
        })),
      },
    ],
    cantidadDePruebas: 2,
    soloCircuito: false,
    official: true,
    updatedAt: Date.now(),
  };
}

const PARTE_ETAPA2: ScoreboardPart = {
  ...PARTE,
  id: "p2",
  workoutId: "w2",
  workoutName: "Final",
  orderIndex: 1000,
  stage: 2,
};

/**
 * Construye un equipo con su entrada, mismo formato que produce
 * `buildScoreboard`: el `team` va embebido en cada entrada.
 */
function equipo(teamId: string, bib: number, nombre: string, entradaBase: Partial<OverallEntry> = {}) {
  return {
    ...entrada({ teamId, ...entradaBase }),
    team: {
      id: teamId,
      divisionId: "d1",
      bib,
      name: null,
      athletes: nombre,
      countries: [],
    },
  };
}

/**
 * Una categoria con un corte confirmado: t1 avanzo a la Etapa 2 (con
 * placements ACUMULADOS de las dos etapas, igual que hace `buildScoreboard`
 * en la "vista" de la etapa final), t2 quedo eliminado y solo aparece en la
 * Etapa 1.
 */
function datosConCorte(): Datos {
  const placementEtapa2 = {
    partId: "p2",
    teamId: "t1",
    status: "valido" as const,
    position: 1,
    tiedWith: 1,
    points: 100,
    comparable: { statusRank: 0, value: 5, tiebreak: null },
    value: 5,
    reps: 0,
    capValue: null,
    roundBreakdown: null,
  };

  return {
    divisiones: [
      {
        division: { id: "d1", name: "Rx" },
        stage: 1,
        parts: [PARTE],
        entries: [
          equipo("t1", 101, "Ana Perez", { position: 1, totalPoints: 50, displayPoints: 50 }),
          equipo("t2", 102, "Beto Gomez", { position: 2, totalPoints: 40, displayPoints: 40 }),
        ],
      },
      {
        division: { id: "d1", name: "Rx" },
        stage: 2,
        // La etapa final acumula las partes de las dos etapas -- ver
        // `partesAcumuladas` en scoreboard.ts.
        parts: [PARTE, PARTE_ETAPA2],
        entries: [
          // Solo t1 sigue en el pool: sus placements acumulan la Etapa 1 (p1)
          // y la Etapa 2 (p2), y el total suma las dos.
          equipo("t1", 101, "Ana Perez", {
            position: 1,
            totalPoints: 150,
            displayPoints: 150,
            placements: [entrada().placements[0], placementEtapa2],
          }),
        ],
      },
    ],
    cantidadDePruebas: 2,
    soloCircuito: false,
    official: true,
    updatedAt: Date.now(),
  };
}

describe("una categoria con corte confirmado (varias etapas)", () => {
  it("muestra una sola tabla, sin pestana por etapa", async () => {
    render(<TablaGeneral slug="copa-test" inicial={datosConCorte()} />);

    // Una sola categoria: no hay pestanas, ni siquiera con dos etapas.
    expect(screen.queryByRole("button", { name: "Rx" })).toBeNull();
    // Los dos equipos, activo y eliminado, en la MISMA tabla.
    expect(screen.getByText("Ana Perez")).toBeTruthy();
    expect(screen.getByText("Beto Gomez")).toBeTruthy();
  });

  it("marca a quien sigue como Activo y a quien no avanzo como Eliminado", async () => {
    render(<TablaGeneral slug="copa-test" inicial={datosConCorte()} />);

    expect(screen.getByText("Activo")).toBeTruthy();
    expect(screen.getByText("Eliminado")).toBeTruthy();
  });

  it("el filtro de categoria aparece cuando hay mas de una categoria", async () => {
    const dos = datosConCorte();
    dos.divisiones.push({
      division: { id: "d2", name: "Scaled" },
      stage: 1,
      parts: [PARTE],
      entries: [equipo("t3", 201, "Cami Diaz")],
    });

    render(<TablaGeneral slug="copa-test" inicial={dos} />);

    expect(screen.getByRole("button", { name: "Rx" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scaled" })).toBeTruthy();
  });
});

describe("el detalle de un WOD por rondas", () => {
  it("muestra el desglose movimiento por movimiento en vez de 'N rondas + M reps'", async () => {
    render(<TablaGeneral slug="copa-test" inicial={datos([entrada()])} />);

    fireEvent.click(screen.getByTitle("Ver detalle del atleta"));

    // Nunca el total ambiguo.
    expect(screen.queryByText(/rondas \+/)).toBeNull();
    expect(screen.getByText("Ronda 4")).toBeTruthy();
    expect(screen.getByText(/✓ Pull-up/)).toBeTruthy();
    // Completo: sin fraccion "5/5", solo el check -- ver Push-up/Air Squat
    // abajo, que SI muestran cuanto llevan sobre el objetivo.
    expect(screen.queryByText(/Pull-up 5\/5/)).toBeNull();
  });

  it("un movimiento a medias muestra cuanto lleva sobre el objetivo", async () => {
    render(<TablaGeneral slug="copa-test" inicial={datos([entrada()])} />);
    fireEvent.click(screen.getByTitle("Ver detalle del atleta"));
    expect(screen.getByText(/Push-up 6\/10/)).toBeTruthy();
    expect(screen.getByText(/Air Squat 0\/15/)).toBeTruthy();
  });

  it("sin roundBreakdown, cae al total 'rondas + reps' de siempre", async () => {
    const sinDesglose = entrada();
    sinDesglose.placements[0] = { ...sinDesglose.placements[0], roundBreakdown: null };
    render(<TablaGeneral slug="copa-test" inicial={datos([sinDesglose])} />);

    fireEvent.click(screen.getByTitle("Ver detalle del atleta"));
    expect(screen.getByText(/3 rondas \+ 11 reps/)).toBeTruthy();
  });
});
