// @vitest-environment jsdom

/*
 * Lo que un atleta lee de un WOD en la ficha publica.
 *
 * Dos cosas que se rompen justo aca y en ningun otro lado:
 *
 *   El PESO se muestra en la unidad en que lo escribio el organizador. La base
 *   guarda kilos —es lo que compara el motor— pero "43,09 kg" no esta en ningun
 *   reglamento: quien programo el WOD escribio "95 lb" y eso es lo que el
 *   atleta tiene que reconocer.
 *
 *   Una prueba SIN LIBERAR se lista pero no se abre. El organizador carga los
 *   WODs con semanas de anticipacion para configurar la pantalla del juez, y
 *   cuando se revelan lo decide el.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "../../../../test/render";
import { PanelDeWorkouts } from "./PanelDeWorkouts";
import type { EventoPublico } from "../queries";

afterEach(cleanup);

const MOVIMIENTO = {
  nombre: "Thruster",
  unidad: "reps",
  objetivo: [21, 15, 9],
  // 43,09 kg son 95 lb.
  cargaKg: 43.09,
  cargaUnidad: "lb" as const,
  maxReps: false,
  notas: null,
  porCategoria: [] as EventoPublico["workouts"][number]["parts"][number]["blocks"][number]["movimientos"][number]["porCategoria"],
};

const PARTE = {
  label: "",
  timeScheme: "cap",
  scoreUnit: "tiempo",
  scoreDir: "menor_gana",
  teamMode: "individual",
  timeCapMs: 600_000,
  windowMs: null,
  intervalMs: null,
  capPorCategoria: [] as Array<{ division: string; timeCapMs: number }>,
  divisiones: ["Elite Masculino"],
  blocks: [
    {
      kind: "trabajo",
      label: null,
      rondas: 3,
      duracionMs: null,
      descansoMs: null,
      movimientos: [MOVIMIENTO],
    },
  ],
};

function evento(over: Partial<EventoPublico["workouts"][number]> = {}): EventoPublico {
  return {
    format: "crossfit",
    workouts: [
      {
        name: "Fran",
        liberado: true,
        description: null,
        parts: [PARTE],
        ...over,
      },
    ],
  } as unknown as EventoPublico;
}

describe("el peso", () => {
  it("se muestra en libras cuando así se programó, no en kilos", () => {
    render(<PanelDeWorkouts evento={evento()} />);

    expect(screen.getByText("95 lb")).toBeTruthy();
    expect(screen.queryByText(/43[.,]09/)).toBeNull();
  });

  it("el peso de cada categoría también", () => {
    // Elite no tiene ajuste: hereda el de la prueba, que es el caso normal.
    // Scaled sí, y es lo que decide en cuál se anota alguien.
    const conCategorias = evento();
    conCategorias.workouts[0].parts[0].blocks[0].movimientos[0].porCategoria = [
      { division: "Scaled", objetivo: [15, 12, 9], cargaKg: 29.48, cargaUnidad: "lb", notas: null },
    ];

    render(<PanelDeWorkouts evento={conCategorias} />);

    expect(screen.getByText("95 lb")).toBeTruthy();
    expect(screen.getByText("15-12-9 · 65 lb")).toBeTruthy();
  });
});

describe("el cap por categoría", () => {
  it("no se pinta si todas comparten el de la prueba", () => {
    render(<PanelDeWorkouts evento={evento()} />);
    expect(screen.queryByText(/Cap por categoría/)).toBeNull();
  });

  it("se pinta cuando alguna lo cambia", () => {
    const conCap = evento();
    conCap.workouts[0].parts[0].capPorCategoria = [
      { division: "Elite Masculino", timeCapMs: 600_000 },
      { division: "Scaled", timeCapMs: 900_000 },
    ];

    render(<PanelDeWorkouts evento={conCap} />);

    expect(screen.getByText(/Cap por categoría/)).toBeTruthy();
    expect(screen.getByText("15 min")).toBeTruthy();
  });
});

describe("una prueba sin liberar", () => {
  it("se lista con su nombre pero no muestra el contenido", () => {
    render(<PanelDeWorkouts evento={evento({ liberado: false })} />);

    expect(screen.getByText("Fran")).toBeTruthy();
    expect(screen.getByText("Se anuncia más adelante")).toBeTruthy();
    // Ni los movimientos ni los pesos: es lo que el organizador todavía no
    // quiso revelar.
    expect(screen.queryByText("Thruster")).toBeNull();
    expect(screen.queryByText("95 lb")).toBeNull();
  });
});
