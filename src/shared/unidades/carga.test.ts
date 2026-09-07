import { describe, expect, it } from "vitest";
import { aKilos, desdeKilos, formatearCarga } from "./carga";

describe("kilos y libras", () => {
  it("los kilos pasan sin tocarse", () => {
    expect(aKilos(43, "kg")).toBe(43);
    expect(desdeKilos(43, "kg")).toBe(43);
  });

  it("un peso cargado en libras vuelve como el mismo número", () => {
    // Es el punto de guardar la unidad: quien programó "95 lb" —el número
    // redondo del reglamento— tiene que ver 95, no 43,09.
    for (const lb of [65, 95, 115, 135, 155, 185, 225]) {
      expect(desdeKilos(aKilos(lb, "lb"), "lb")).toBe(lb);
    }
  });

  it("el factor es el exacto, no 2,2", () => {
    // Con 2,2 el round-trip de 95 lb devuelve 94,6 y el número deja de ser el
    // del reglamento.
    expect(aKilos(95, "lb")).toBeCloseTo(43.09, 2);
  });

  it("se muestra sin decimales cuando es entero", () => {
    expect(formatearCarga(43, "kg")).toBe("43 kg");
    expect(formatearCarga(aKilos(95, "lb"), "lb")).toBe("95 lb");
  });

  it("sin peso no inventa un cero", () => {
    // Un burpee no lleva peso, y "0 kg" diría que sí lo lleva.
    expect(formatearCarga(null, "kg")).toBeNull();
  });
});
