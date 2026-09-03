// @vitest-environment jsdom

/*
 * Lo que se le pide a una categoria depende del FORMATO, y no es cosmetico:
 *
 *   crossfit         movimientos con su peso, y que tabla de puntos usa. Un
 *                    CrossFit compara puestos entre pruebas, asi que elegir la
 *                    tabla es una decision real del organizador.
 *   carrera hibrida  nada mas que cupo y datos basicos. El circuito se crea
 *                    con una configuracion en "Circuito" y esa es — no se
 *                    ajusta por categoria, y no hay tabla que elegir: el
 *                    tiempo es el tiempo.
 *
 * Preguntar por un circuito en un CrossFit —o por una tabla de puntos en una
 * carrera— hace dudar de si la herramienta entendio que competencia se esta
 * armando. Este test falla si las dos ramas se cruzan.
 *
 * El contenido vive dentro de un modal cerrado, asi que hay que abrirlo:
 * pedir la pagina por HTTP no lo muestra nunca.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "../../../../test/render";
import { FilaDeCategoria } from "./ParametrosDeCategoria";
import type { CategoriaConfigurada } from "@/features/events/config/queries";

// Un `"use server"` no corre en jsdom: las acciones se sustituyen.
vi.mock("@/features/events/config/categorias", () => ({
  guardarCategoria: vi.fn(async () => ({ error: null })),
  agregarMovimientoDeCategoria: vi.fn(async () => ({ error: null })),
  quitarMovimientoDeCategoria: vi.fn(async () => {}),
}));

// Cada caso pinta el mismo componente: sin limpiar, el segundo encuentra dos.
afterEach(cleanup);

const CATEGORIA: CategoriaConfigurada = {
  id: "div-1",
  name: "Elite Masculino",
  teamSize: 1,
  genderRule: "male",
  ageMin: null,
  ageMax: null,
  courseTemplateId: "tpl-1",
  scoringTableId: null,
  capacity: null,
  permiteCambios: false,
  equiposInscritos: 0,
  movimientos: [],
  segmentos: {},
};

const SEGMENTOS = [
  { id: "seg-1", name: "1km Run", kind: "run", order_index: 0 },
];
const CATALOGO = [
  {
    id: "mov-1",
    name: "Thruster",
    category: "levantamiento",
    allows_load: true,
  },
];
const TABLAS = [{ id: "tab-1", name: "CrossFit Games 40" }];
const TEMPLATES = [
  { id: "tpl-1", event_id: "ev-1", name: "Circuito estándar", created_at: "" },
];

function pintar(
  formato: "crossfit" | "carrera_hibrida",
  categoria: CategoriaConfigurada = CATEGORIA,
) {
  render(
    <table>
      <tbody>
        <FilaDeCategoria
          eventId="ev-1"
          categoria={categoria}
          formato={formato}
          segmentos={SEGMENTOS}
          catalogo={CATALOGO}
          tablas={TABLAS}
          templates={TEMPLATES}
          alQuitar={async () => ({ error: null })}
        />
      </tbody>
    </table>,
  );
}

function abrir() {
  fireEvent.click(screen.getByRole("button", { name: "Editar" }));
}

describe("parámetros de categoría", () => {
  it("el límite de registros se pide en los dos formatos, y vacío es ilimitado", () => {
    pintar("crossfit");
    abrir();

    const cupo = screen.getByLabelText(
      /Límite de registros/,
    ) as HTMLInputElement;
    expect(cupo.value).toBe("");
    // El placeholder es lo que comunica la regla: un campo vacío sin texto no
    // distingue "sin límite" de "todavía no lo configuré".
    expect(cupo.placeholder).toBe("Sin límite");
  });

  it("un CrossFit pide movimientos y tabla de puntos, no circuito", () => {
    pintar("crossfit");
    abrir();

    expect(screen.getByText("Movimientos y pesos")).toBeTruthy();
    expect(screen.getByLabelText(/Sistema de puntuación/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Circuito/)).toBeNull();
  });

  it("una carrera híbrida no ofrece movimientos ni tabla de puntos ni parámetros del circuito", () => {
    // El circuito se crea con una configuracion y esa es: no se ajusta por
    // categoria desde este modal.
    pintar("carrera_hibrida");
    abrir();

    expect(screen.getByLabelText(/^Circuito/)).toBeTruthy();
    // Una carrera se gana llegando antes: no hay nada que elegir.
    expect(screen.getByText(/Por tiempo, menor gana/)).toBeTruthy();
    expect(screen.queryByLabelText(/Sistema de puntuación/)).toBeNull();
    expect(screen.queryByText("Movimientos y pesos")).toBeNull();
    expect(screen.queryByText("Parámetros del circuito")).toBeNull();
    expect(screen.queryByText("1km Run")).toBeNull();
  });

  it("el catálogo ofrece los movimientos con su nombre real", () => {
    pintar("crossfit");
    abrir();

    expect(screen.getByRole("option", { name: "Thruster" })).toBeTruthy();
  });

  it("se puede escribir un movimiento que no está en el catálogo", async () => {
    // El catálogo tiene 148 y aun así falta alguno: cada box inventa el suyo.
    // Sin esta salida, el organizador anota el peso en otro lado y la categoría
    // queda incompleta.
    pintar("crossfit");
    abrir();
    fireEvent.click(
      screen.getByRole("button", { name: /No está en la lista/ }),
    );

    expect(screen.getByPlaceholderText("Nombre del movimiento")).toBeTruthy();
  });

  it("el peso se puede cargar en kilos o en libras", () => {
    pintar("crossfit");
    abrir();

    const unidades = screen
      .getAllByRole("option")
      .filter((o) => ["kg", "lb"].includes(o.textContent ?? ""));
    expect(unidades.map((o) => o.textContent)).toEqual(["kg", "lb"]);
  });
});

describe("un solo Guardar y un solo Cancelar por modal", () => {
  it("el modal de edición tiene exactamente un Guardar y un Cancelar", () => {
    pintar("crossfit");
    abrir();

    // "Agregar" (movimientos) es una accion aparte, no un segundo "Guardar".
    expect(screen.getAllByRole("button", { name: "Guardar" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Cancelar" })).toHaveLength(1);
  });
});

describe("cambio de integrantes", () => {
  it("no se ofrece en una categoria individual", () => {
    pintar("crossfit");
    abrir();

    expect(screen.queryByLabelText(/cambiar integrantes/i)).toBeNull();
  });

  it("se ofrece cuando compiten varios", () => {
    pintar("crossfit", { ...CATEGORIA, teamSize: 3 });
    abrir();

    expect(screen.getByText(/Permitir cambiar integrantes/i)).toBeTruthy();
  });
});

describe("eliminar categoría", () => {
  it("no se ofrece si ya tiene equipos inscritos", () => {
    pintar("crossfit", { ...CATEGORIA, equiposInscritos: 3 });

    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
    expect(screen.getByTitle(/No se puede eliminar/)).toBeTruthy();
  });

  it("se ofrece si no tiene ningún equipo", () => {
    pintar("crossfit");

    expect(screen.getByRole("button", { name: "Eliminar" })).toBeTruthy();
  });
});
