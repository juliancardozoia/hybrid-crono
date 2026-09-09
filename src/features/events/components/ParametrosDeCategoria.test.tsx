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
  moverMovimientoDeCategoria: vi.fn(async () => ({ error: null })),
  quitarMovimientoDeCategoria: vi.fn(async () => ({ error: null })),
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
  capacity: null,
  permiteCambios: false,
  permiteCambioCategoria: false,
  equiposInscritos: 0,
  movimientos: [],
  segmentos: {},
};

/**
 * La misma categoría con un movimiento ya cargado, en LIBRAS.
 *
 * 43,09 kg es el valor canónico que guarda la base; 95 lb es el número del
 * reglamento y lo que el organizador escribió.
 */
const CON_THRUSTER: CategoriaConfigurada = {
  ...CATEGORIA,
  movimientos: [
    {
      id: "dm-1",
      nombre: "Thruster",
      loadKg: 43.09,
      loadUnit: "lb",
      spec: null,
    },
  ],
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
  // Un gimnástico no lleva peso, y por eso no se le pregunta uno.
  {
    id: "mov-2",
    name: "Burpee",
    category: "gimnastico",
    allows_load: false,
  },
];
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

/**
 * Elige un movimiento en el alta. Hace falta porque el campo de peso solo
 * aparece cuando el movimiento elegido lo admite: sin elegir nada, no hay peso
 * que pedir.
 */
function elegirDelCatalogo(id: string) {
  // El modal tiene varios `<select>` (integrantes, sexo, circuito…): el del
  // catálogo es el único que ofrece los movimientos.
  const select = screen
    .getAllByRole("combobox")
    .find((s) => s.querySelector('option[value="mov-1"]')) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: id } });
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

  it("un CrossFit pide movimientos y dice con qué se puntúa, sin circuito", () => {
    pintar("crossfit");
    abrir();

    expect(screen.getByText("Parámetros")).toBeTruthy();
    // Hay UN sistema y se adapta solo: se informa, no se elige.
    expect(screen.getByText("Games 2026 Dynamic")).toBeTruthy();
    expect(screen.queryByLabelText(/Sistema de puntuación/)).toBeNull();
    expect(screen.queryByLabelText(/^Circuito/)).toBeNull();
  });

  it("una carrera híbrida no ofrece movimientos ni puntos ni parámetros del circuito", () => {
    // El circuito se crea con una configuracion y esa es: no se ajusta por
    // categoria desde este modal.
    pintar("carrera_hibrida");
    abrir();

    expect(screen.getByLabelText(/^Circuito/)).toBeTruthy();
    // Una carrera se gana llegando antes: no hay nada que elegir.
    expect(screen.getByText(/Por tiempo, menor gana/)).toBeTruthy();
    expect(screen.queryByText("Games 2026 Dynamic")).toBeNull();
    expect(screen.queryByText("Parámetros")).toBeNull();
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
    elegirDelCatalogo("mov-1");

    const unidades = screen
      .getAllByRole("option")
      .filter((o) => ["kg", "lb"].includes(o.textContent ?? ""));
    expect(unidades.map((o) => o.textContent)).toEqual(["kg", "lb"]);
  });

  it("no le pide peso a un movimiento que no lleva", () => {
    // `allows_load` viene del catálogo y hasta ahora se recibía y se
    // descartaba: pedirle kilos a un burpee es ofrecer un dato que no existe.
    pintar("crossfit");
    abrir();
    elegirDelCatalogo("mov-2");

    expect(screen.queryByPlaceholderText("Peso")).toBeNull();
  });

  it("un movimiento ya cargado se corrige en el lugar, sin borrarlo ni un guardado propio", () => {
    // Antes era un chip con una ✕: cambiar 43 por 45 obligaba a borrar la fila
    // y volver a buscar el movimiento entre los 148 del catálogo. Y despues
    // tuvo su propio botón "Actualizar" con su propio viaje al servidor — eso
    // también se sacó: el peso se guarda con el Guardar general del modal.
    pintar("crossfit", CON_THRUSTER);
    abrir();

    const peso = screen.getByDisplayValue("95") as HTMLInputElement;
    expect(peso).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Actualizar" })).toBeNull();

    fireEvent.change(peso, { target: { value: "100" } });
    expect(peso.value).toBe("100");
    expect(screen.queryByRole("button", { name: "Actualizar" })).toBeNull();
  });

  it("un peso cargado en libras se edita en libras, no en kilos", () => {
    // 43,09 kg es lo que se guarda; 95 lb es lo que el organizador escribió y
    // lo que dice el reglamento. Devolverle "43,09" lo haría dudar de la
    // pantalla.
    pintar("crossfit", CON_THRUSTER);
    abrir();

    expect(screen.getByDisplayValue("95")).toBeTruthy();
    expect(screen.queryByDisplayValue("43.09")).toBeNull();
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

  it("sigue siendo uno solo incluso al tocar el peso de un movimiento", () => {
    // El peso de cada movimiento ya no tiene su propio botón: entra con el
    // mismo Guardar general, así que tocarlo no puede hacer aparecer un
    // segundo botón en el modal.
    pintar("crossfit", CON_THRUSTER);
    abrir();
    fireEvent.change(screen.getByDisplayValue("95"), {
      target: { value: "100" },
    });

    expect(screen.getAllByRole("button", { name: "Guardar" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Actualizar" })).toBeNull();
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

describe("cambio de categoría", () => {
  // A diferencia de "cambiar integrantes", esto vale igual en individual: no
  // depende del formato ni de cuantos integrantes compitan.
  it("se ofrece en crossfit, individual", () => {
    pintar("crossfit");
    abrir();

    expect(screen.getByText(/Habilitar cambio de categoría/i)).toBeTruthy();
  });

  it("se ofrece en carrera híbrida", () => {
    pintar("carrera_hibrida");
    abrir();

    expect(screen.getByText(/Habilitar cambio de categoría/i)).toBeTruthy();
  });

  it("refleja el valor ya guardado", () => {
    pintar("crossfit", { ...CATEGORIA, permiteCambioCategoria: true });
    abrir();

    const toggle = screen.getByRole("checkbox", {
      name: /Habilitar cambio de categoría/i,
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
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
