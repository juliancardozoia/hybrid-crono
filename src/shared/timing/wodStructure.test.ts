/**
 * El ensamblado fila-de-base -> estructura del WOD.
 *
 * Es el punto donde el peso de la CATEGORIA pisa al del movimiento, y hasta
 * ahora no tenia un solo test. Lo llaman dos lugares —el bundle que se lleva el
 * celular del juez y el recalculo del servidor— y el propio archivo dice por
 * que existe: si cada uno lo escribiera por su cuenta, alcanzaria con que uno
 * se olvidara de aplicar el peso de la categoria para que el juez viera 43 kg y
 * el resultado oficial saliera con otro numero.
 */

import { describe, expect, it } from "vitest";
import {
  armarEstructuraDeWod,
  type EspecificacionDeCategoria,
  type FilaDeBloque,
  type FilaDeMovimiento,
  type FilaDeParte,
} from "./wodStructure";

const PARTE: FilaDeParte = {
  id: "p1",
  label: "",
  order_index: 0,
  time_scheme: "cap",
  score_unit: "tiempo",
  time_cap_ms: 600_000,
  window_ms: null,
  interval_ms: null,
};

const BLOQUE: FilaDeBloque = {
  id: "b1",
  part_id: "p1",
  order_index: 0,
  kind: "trabajo",
  repeticiones: 3,
  duracion_ms: null,
  descanso_ms: null,
};

const THRUSTER: FilaDeMovimiento = {
  id: "m1",
  block_id: "b1",
  part_id: "p1",
  order_index: 0,
  movement_id: "cat-thruster",
  custom_name: null,
  unit: "reps",
  target_per_round: [21, 15, 9],
  load_kg: 43,
  load_unit: "kg",
  max_reps: false,
  es_tiebreak: false,
  capture_style: null,
  max_attempts: 3,
};

const NOMBRES = new Map([["cat-thruster", "Thruster"]]);

function armar(
  over: {
    movimientos?: FilaDeMovimiento[];
    specs?: Map<string, EspecificacionDeCategoria>;
    capDeCategoriaMs?: number | null;
    bloques?: FilaDeBloque[];
  } = {},
) {
  return armarEstructuraDeWod({
    parte: PARTE,
    bloques: over.bloques ?? [BLOQUE],
    movimientos: over.movimientos ?? [THRUSTER],
    nombres: NOMBRES,
    specs: over.specs ?? new Map(),
    capDeCategoriaMs: over.capDeCategoriaMs,
  });
}

const primerMovimiento = (e: ReturnType<typeof armar>) => e.blocks[0].movements[0];

describe("el nombre del movimiento", () => {
  it("sale del catálogo cuando está referenciado", () => {
    expect(primerMovimiento(armar()).name).toBe("Thruster");
  });

  it("sale del texto libre cuando no está en el catálogo", () => {
    const suyo = { ...THRUSTER, movement_id: null, custom_name: "Worm Carry" };
    expect(primerMovimiento(armar({ movimientos: [suyo] })).name).toBe("Worm Carry");
  });

  it("no se rompe si el catálogo no trajo ese id", () => {
    const huerfano = { ...THRUSTER, movement_id: "no-existe" };
    expect(primerMovimiento(armar({ movimientos: [huerfano] })).name).toBe("Movimiento");
  });
});

describe("Rx contra Scaled: la categoría manda", () => {
  it("sin spec, valen el peso y las reps del movimiento", () => {
    const m = primerMovimiento(armar());
    expect(m.loadKg).toBe(43);
    expect(m.targetPerRound).toEqual([21, 15, 9]);
  });

  it("con spec, el peso y las reps de la categoría pisan al base", () => {
    const specs = new Map([
      ["m1", { target_per_round: [15, 12, 9], load_kg: 30, load_unit: "kg" }],
    ]);
    const m = primerMovimiento(armar({ specs }));
    expect(m.loadKg).toBe(30);
    expect(m.targetPerRound).toEqual([15, 12, 9]);
  });

  it("una spec parcial solo pisa lo que trae", () => {
    // El objetivo va en null: la categoría cambia el peso y hace las mismas
    // repeticiones. Es el caso más común de Scaled.
    const specs = new Map([
      ["m1", { target_per_round: null, load_kg: 30, load_unit: "kg" }],
    ]);
    const m = primerMovimiento(armar({ specs }));
    expect(m.loadKg).toBe(30);
    expect(m.targetPerRound).toEqual([21, 15, 9]);
  });

  it("la UNIDAD acompaña al peso de la categoría, no se mezcla con la base", () => {
    // Sin esto se mostraría el 95 de la categoría con el "kg" del movimiento.
    const specs = new Map([
      ["m1", { target_per_round: null, load_kg: 43.09, load_unit: "lb" }],
    ]);
    expect(primerMovimiento(armar({ specs })).loadUnit).toBe("lb");
  });

  it("sin peso propio, la unidad sigue siendo la del movimiento", () => {
    const enLibras = { ...THRUSTER, load_unit: "lb" };
    const specs = new Map([
      ["m1", { target_per_round: [10], load_kg: null, load_unit: "kg" }],
    ]);
    expect(primerMovimiento(armar({ movimientos: [enLibras], specs })).loadUnit).toBe("lb");
  });
});

describe("el tope de tiempo", () => {
  it("sin cap de categoría vale el de la parte", () => {
    expect(armar().timeCapMs).toBe(600_000);
  });

  it("el cap de la categoría pisa al de la parte", () => {
    // `part_divisions.time_cap_ms` existía desde el día uno y no la leía nadie:
    // Elite y Scaled capeaban en el mismo minuto. Y como el cap se DERIVA del
    // reloj, el error se materializaba en el score sin que nadie emitiera nada.
    expect(armar({ capDeCategoriaMs: 900_000 }).timeCapMs).toBe(900_000);
  });
});

describe("qué entra en la estructura", () => {
  it("un movimiento de otro bloque no se cuela", () => {
    const ajeno = { ...THRUSTER, id: "m9", block_id: "b9" };
    const e = armar({ movimientos: [THRUSTER, ajeno] });
    expect(e.blocks[0].movements.map((m) => m.id)).toEqual(["m1"]);
  });

  it("un bloque de otra parte no se cuela", () => {
    const ajeno = { ...BLOQUE, id: "b9", part_id: "p9" };
    expect(armar({ bloques: [BLOQUE, ajeno] }).blocks).toHaveLength(1);
  });

  it("bloques y movimientos salen ordenados por su índice, no por el arreglo", () => {
    const segundo = { ...THRUSTER, id: "m2", order_index: 1 };
    const e = armar({ movimientos: [segundo, THRUSTER] });
    expect(e.blocks[0].movements.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("el estilo de captura viaja crudo: lo resuelve planDelWod", () => {
    // Acá todavía no se sabe el objetivo de cada ronda, que es de lo que
    // depende el derivado.
    expect(primerMovimiento(armar()).captureStyle).toBeNull();
    const fijado = { ...THRUSTER, capture_style: "hecho" };
    expect(primerMovimiento(armar({ movimientos: [fijado] })).captureStyle).toBe("hecho");
  });
});
