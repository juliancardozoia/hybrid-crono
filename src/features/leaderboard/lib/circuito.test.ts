import { describe, expect, it } from "vitest";
import {
  duracionesDeReferencia,
  fraccionDelTramo,
  progresoDeCircuito,
  TOPE_DEL_TRAMO,
  VUELTA_SIN_REFERENCIA_MS,
  type SegmentoDeCircuito,
} from "./circuito";
import { columnasPara, disposicionSerpentina, partirEtiqueta } from "./serpentina";
import type { LeaderboardSplit } from "../queries";

const CIRCUITO: SegmentoDeCircuito[] = [
  { id: "s0", orderIndex: 0, kind: "run", name: "1km Run" },
  { id: "s1", orderIndex: 1, kind: "station", name: "SkiErg 1000m" },
  { id: "s2", orderIndex: 2, kind: "run", name: "1km Run" },
  { id: "s3", orderIndex: 3, kind: "station", name: "Sled Push 50m" },
];

function split(orderIndex: number, cumulativeMs: number, durationMs: number): LeaderboardSplit {
  return {
    segmentName: CIRCUITO[orderIndex].name,
    orderIndex,
    cumulativeMs,
    durationMs,
  };
}

describe("progresoDeCircuito", () => {
  it("la estacion actual es el primer segmento sin parcial", () => {
    const p = progresoDeCircuito(
      {
        status: "running",
        splits: [split(0, 300_000, 300_000), split(1, 540_000, 240_000)],
      },
      CIRCUITO,
    );

    expect(p.actual?.name).toBe("1km Run");
    expect(p.indiceActual).toBe(2);
    expect(p.completados).toBe(2);
    expect(p.total).toBe(4);
    // Desde cuando corre la estacion actual: el acumulado del ultimo cierre.
    expect(p.desdeMs).toBe(540_000);
    expect(p.parciales.map((x) => x.estado)).toEqual(["hecho", "hecho", "en_curso", "pendiente"]);
  });

  it("recien largado, sin ningun parcial, esta en la primera estacion", () => {
    const p = progresoDeCircuito({ status: "running", splits: [] }, CIRCUITO);

    expect(p.indiceActual).toBe(0);
    expect(p.desdeMs).toBe(0);
  });

  it("un carril terminado no tiene estacion actual", () => {
    for (const status of ["finished", "dnf", "dq"] as const) {
      const p = progresoDeCircuito({ status, splits: [split(0, 300_000, 300_000)] }, CIRCUITO);
      expect(p.actual).toBeNull();
      expect(p.indiceActual).toBeNull();
    }
  });

  it("un marcaje fuera de orden no corre de lugar los parciales siguientes", () => {
    // Falta el 1 y esta el 2: contar por cantidad de splits diria que la
    // estacion actual es la tercera, cuando la que quedo sin cerrar es la
    // segunda.
    const p = progresoDeCircuito(
      {
        status: "running",
        splits: [split(0, 300_000, 300_000), split(2, 900_000, 360_000)],
      },
      CIRCUITO,
    );

    expect(p.indiceActual).toBe(1);
    expect(p.parciales[2].estado).toBe("hecho");
    // El arranque de la estacion actual es el acumulado MAS ALTO ya cerrado.
    expect(p.desdeMs).toBe(900_000);
  });

  it("un circuito sin segmentos no inventa una estacion actual", () => {
    const p = progresoDeCircuito({ status: "running", splits: [] }, []);
    expect(p.actual).toBeNull();
    expect(p.total).toBe(0);
  });
});

describe("duracionesDeReferencia", () => {
  it("toma la mediana y no el promedio", () => {
    const referencia = duracionesDeReferencia([
      { splits: [split(0, 300_000, 300_000)] },
      { splits: [split(0, 310_000, 310_000)] },
      // Un split anomalo de dos segundos correria el promedio a 207s; la
      // mediana lo ignora.
      { splits: [split(0, 2_000, 2_000)] },
    ]);

    expect(referencia.get(0)).toBe(300_000);
  });

  it("descarta duraciones no positivas y segmentos que nadie corrio todavia", () => {
    const referencia = duracionesDeReferencia([{ splits: [split(0, 0, 0), split(1, 100, 100)] }]);

    expect(referencia.has(0)).toBe(false);
    expect(referencia.get(1)).toBe(100);
  });
});

describe("fraccionDelTramo", () => {
  it("nunca llega a 1: el unico que cierra una estacion es el juez", () => {
    for (const t of [1, 99, 100, 101, 5_000, 999_999]) {
      expect(fraccionDelTramo(t, 100)).toBeLessThanOrEqual(TOPE_DEL_TRAMO);
    }
  });

  it("avanza proporcional a lo que suelen tardar los demas", () => {
    expect(fraccionDelTramo(60_000, 240_000)).toBeCloseTo(0.25 * TOPE_DEL_TRAMO);
  });

  it("al alcanzar la referencia vuelve a empezar en vez de quedarse lleno", () => {
    const casiLlena = fraccionDelTramo(239_000, 240_000);
    expect(casiLlena).toBeGreaterThan(0.9 * TOPE_DEL_TRAMO);
    // Justo despues de completar la vuelta, arranca otra desde cero.
    expect(fraccionDelTramo(241_000, 240_000)).toBeLessThan(0.05);
    // Y sigue repitiendo: la tercera vuelta es igual a la primera.
    expect(fraccionDelTramo(60_000 + 2 * 240_000, 240_000)).toBeCloseTo(
      fraccionDelTramo(60_000, 240_000),
    );
  });

  it("sin referencia tambien se anima, con una vuelta fija", () => {
    expect(fraccionDelTramo(VUELTA_SIN_REFERENCIA_MS / 2, null)).toBeCloseTo(0.5 * TOPE_DEL_TRAMO);
    expect(fraccionDelTramo(VUELTA_SIN_REFERENCIA_MS / 2, 0)).toBeCloseTo(0.5 * TOPE_DEL_TRAMO);
  });

  it("antes de largar no hay nada que mostrar", () => {
    expect(fraccionDelTramo(0, 100)).toBe(0);
    expect(fraccionDelTramo(-5, null)).toBe(0);
  });
});

describe("disposicionSerpentina", () => {
  it("reparte 16 estaciones en filas parejas, sin pasar de seis por fila", () => {
    expect(columnasPara(16)).toBe(6);
    const d = disposicionSerpentina(16);
    expect(d.filas).toBe(3);
    expect(d.cajas).toHaveLength(16);
    expect(d.conectores).toHaveLength(15);
  });

  it("las filas impares se recorren al reves, asi el recorrido es continuo", () => {
    const d = disposicionSerpentina(16);
    // La ultima de la fila 0 y la primera de la fila 1 comparten columna: la
    // vuelta en U las une por el costado.
    expect(d.cajas[5].x).toBe(d.cajas[6].x);
    expect(d.cajas[6].y).toBeGreaterThan(d.cajas[5].y);
    // Y la fila 1 avanza hacia la izquierda.
    expect(d.cajas[7].x).toBeLessThan(d.cajas[6].x);
  });

  it("un circuito corto entra en una sola fila", () => {
    const d = disposicionSerpentina(4);
    expect(d.filas).toBe(1);
    expect(d.cajas.every((c) => c.y === d.cajas[0].y)).toBe(true);
    // Con una sola fila, la meta sale por la derecha.
    expect(d.meta.x).toBeGreaterThan(d.cajas[3].x);
  });

  it("la meta sale por el lado por el que se recorrio la ultima fila", () => {
    // Con 12 estaciones son dos filas: la segunda va hacia la izquierda.
    const dosFilas = disposicionSerpentina(12);
    expect(dosFilas.filas).toBe(2);
    expect(dosFilas.meta.x).toBe(dosFilas.cajas[11].x);

    // Con 16 son tres: la tercera vuelve a ir hacia la derecha.
    const tresFilas = disposicionSerpentina(16);
    expect(tresFilas.meta.x).toBeGreaterThan(tresFilas.cajas[15].x);
  });

  it("no revienta con un circuito de un solo segmento", () => {
    const d = disposicionSerpentina(1);
    expect(d.cajas).toHaveLength(1);
    expect(d.conectores).toHaveLength(0);
  });
});

describe("partirEtiqueta", () => {
  it("corta por palabra, no por caracter", () => {
    expect(partirEtiqueta("Burpee Broad Jump 80m", 15, 2)).toEqual(["Burpee Broad", "Jump 80m"]);
  });

  it("lo que no entra se avisa con puntos suspensivos", () => {
    const lineas = partirEtiqueta("Sandbag Lunges 100m con chaleco lastrado", 15, 2);
    expect(lineas).toHaveLength(2);
    expect(lineas[1].endsWith("…")).toBe(true);
  });

  it("una palabra mas larga que la linea se recorta en vez de desbordar", () => {
    expect(partirEtiqueta("Supercalifragilistico", 15, 2)).toEqual(["Supercalifragi…"]);
  });
});
