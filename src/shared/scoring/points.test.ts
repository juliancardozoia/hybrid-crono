import { describe, expect, it } from "vitest";
import {
  CF_GAMES_40,
  CF_GAMES_80,
  TABLA_CF_GAMES_40,
  TABLA_CF_GAMES_80,
  TABLA_CF_OPEN,
  TABLA_TIEMPO_TOTAL,
  pointsForPosition,
  tablaPersonalizada,
} from "./points";

/**
 * Las tablas se escriben literales porque un organizador las audita fila por
 * fila contra la oficial. Estos tests son la contraparte: verifican que la
 * literal coincida con la formula, asi que un dedazo al transcribir no pasa.
 */
function generar(cabecera: number[], desde: number, hasta: number, base: number): number[] {
  const tabla = [...cabecera];
  for (let puesto = desde; puesto <= hasta; puesto++) {
    tabla.push(base - (puesto - 10) * 2);
  }
  return tabla;
}

describe("tablas de puntos", () => {
  it("CF-Games 40 tiene 40 puestos, de 100 a 0", () => {
    expect(CF_GAMES_40).toHaveLength(40);
    expect(CF_GAMES_40[0]).toBe(100);
    expect(CF_GAMES_40[39]).toBe(0);
  });

  it("CF-Games 40 coincide con su formula: 10 explicitos y despues -2 por puesto", () => {
    const esperada = generar([100, 94, 88, 84, 80, 76, 72, 68, 64, 60], 11, 40, 60);
    expect([...CF_GAMES_40]).toEqual(esperada);
  });

  it("CF-Games 80 tiene 80 puestos y sus valores de referencia", () => {
    expect(CF_GAMES_80).toHaveLength(80);
    expect(CF_GAMES_80[0]).toBe(200);
    expect(CF_GAMES_80[9]).toBe(160);
    // El puesto 40 vale 100 y el 41 vale 98: es donde la tabla de 80 cruza a la
    // mitad de su escala.
    expect(CF_GAMES_80[39]).toBe(100);
    expect(CF_GAMES_80[40]).toBe(98);
    expect(CF_GAMES_80[79]).toBe(20);
  });

  it("CF-Games 80 coincide con su formula", () => {
    const esperada = generar([200, 194, 188, 184, 180, 176, 172, 168, 164, 160], 11, 80, 160);
    expect([...CF_GAMES_80]).toEqual(esperada);
  });

  it("las dos tablas de Games premian ganar mucho mas que salir quinto", () => {
    // Del 1 al 2 se pierden 6 puntos; del 5 al 6, solo 4. Es lo que obliga al
    // que va primero a no especular.
    expect(CF_GAMES_40[0] - CF_GAMES_40[1]).toBe(6);
    expect(CF_GAMES_40[4] - CF_GAMES_40[5]).toBe(4);
  });
});

describe("pointsForPosition", () => {
  it("devuelve el valor de la tabla en cada puesto", () => {
    expect(pointsForPosition(TABLA_CF_GAMES_40, 1)).toBe(100);
    expect(pointsForPosition(TABLA_CF_GAMES_40, 3)).toBe(88);
    expect(pointsForPosition(TABLA_CF_GAMES_40, 40)).toBe(0);
    expect(pointsForPosition(TABLA_CF_GAMES_80, 80)).toBe(20);
  });

  it("mas alla de la tabla repite el ultimo valor", () => {
    // Con 100 inscriptos y una tabla de 80, los puestos 81 a 100 empatan. Que
    // eso se vea antes de competir es responsabilidad de la validacion del
    // evento; el motor no puede inventar puntos que la tabla no define.
    expect(pointsForPosition(TABLA_CF_GAMES_80, 81)).toBe(20);
    expect(pointsForPosition(TABLA_CF_GAMES_80, 200)).toBe(20);
  });

  it("en CF-Open los puntos son la posicion y no hay tope", () => {
    expect(pointsForPosition(TABLA_CF_OPEN, 1)).toBe(1);
    expect(pointsForPosition(TABLA_CF_OPEN, 37)).toBe(37);
    expect(pointsForPosition(TABLA_CF_OPEN, 10_000)).toBe(10_000);
  });

  it("tiempo_total es CF-Open con otro nombre", () => {
    expect(TABLA_TIEMPO_TOTAL.points).toHaveLength(0);
    expect(TABLA_TIEMPO_TOTAL.dir).toBe("menor_gana");
  });

  it("una posicion invalida no rompe el calculo", () => {
    expect(pointsForPosition(TABLA_CF_GAMES_40, 0)).toBe(0);
  });
});

describe("tablas personalizadas", () => {
  it("una tabla con valores gana con el mayor puntaje", () => {
    const tabla = tablaPersonalizada("finales", "Finales", [50, 30, 20]);
    expect(tabla.dir).toBe("mayor_gana");
    expect(pointsForPosition(tabla, 2)).toBe(30);
    expect(pointsForPosition(tabla, 9)).toBe(20);
  });

  it("una tabla vacia se comporta como CF-Open", () => {
    const tabla = tablaPersonalizada("posicion", "Por posicion", []);
    expect(tabla.dir).toBe("menor_gana");
    expect(pointsForPosition(tabla, 12)).toBe(12);
  });
});
