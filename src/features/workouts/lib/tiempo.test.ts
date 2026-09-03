import { describe, expect, it } from "vitest";
import { tiempoAMs } from "./tiempo";

describe("tiempoAMs", () => {
  it("lee minutos y segundos", () => {
    expect(tiempoAMs("12:34")).toBe(12 * 60_000 + 34_000);
  });

  it("lee centesimas", () => {
    expect(tiempoAMs("12:34.56")).toBe(12 * 60_000 + 34_000 + 560);
  });

  it("acepta la coma como separador decimal", () => {
    // Un juez colombiano escribe 12:34,56 sin pensarlo.
    expect(tiempoAMs("12:34,56")).toBe(tiempoAMs("12:34.56"));
  });

  it("lee horas cuando la carrera es larga", () => {
    expect(tiempoAMs("1:02:03")).toBe(3_600_000 + 2 * 60_000 + 3000);
  });

  it("acepta milisegundos sueltos", () => {
    expect(tiempoAMs("754000")).toBe(754_000);
  });

  it("ignora espacios de mas", () => {
    expect(tiempoAMs("  9:05  ")).toBe(9 * 60_000 + 5000);
  });

  it("devuelve null en vez de cero cuando no se entiende", () => {
    // Guardar un cero pondria al atleta primero en una prueba por tiempo. Es
    // preferible pedirlo de nuevo.
    for (const basura of ["", "abc", "12:", ":30", "12:34:56:78", "-5"]) {
      expect(tiempoAMs(basura)).toBeNull();
    }
  });

  it("una sola cifra de segundos tambien se entiende", () => {
    expect(tiempoAMs("9:5")).toBe(9 * 60_000 + 5000);
  });
});
