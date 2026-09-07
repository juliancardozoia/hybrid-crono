import { describe, expect, it } from "vitest";
import { celdasEnKilos, type CeldaDeSpec } from "./pesos";

/**
 * Regresion de un bug real: la grilla de "Pesos y cantidades por categoria"
 * mandaba el numero CRUDO que el organizador escribio (95, si eligio "lb")
 * como si ya fuera kilos, y `guardarSpecs` lo pasaba tal cual al RPC. Al
 * releer, "95 lb" volvia como "209 lb" -sin ninguna relacion con lo que se
 * tipeo- porque `desdeKilos(95, "lb")` interpreta el 95 como kilos.
 *
 * `celdasEnKilos` es la conversion que faltaba, extraida para poder probarla
 * sin mockear el cliente de Supabase -misma cirugia que `calcularScoresDeWod`
 * en `verification/lib/recompute.ts`.
 */
function celda(overrides: Partial<CeldaDeSpec> = {}): CeldaDeSpec {
  return {
    divisionId: "d1",
    partMovementId: "m1",
    objetivo: null,
    cargaKg: null,
    cargaUnidad: "kg",
    ...overrides,
  };
}

describe("celdasEnKilos", () => {
  it("en kg, el numero pasa igual (salvo redondeo a dos decimales)", () => {
    const [r] = celdasEnKilos([celda({ cargaKg: 43, cargaUnidad: "kg" })]);
    expect(r.cargaKg).toBe(43);
  });

  it("en lb, convierte con el factor exacto de la libra", () => {
    const [r] = celdasEnKilos([celda({ cargaKg: 95, cargaUnidad: "lb" })]);
    // 95 lb * 0.45359237 = 43.09127515 -> redondeado a dos decimales.
    expect(r.cargaKg).toBeCloseTo(43.09, 2);
  });

  it("un round-trip de 95 lb vuelve a dar 95, no 209", () => {
    const [r] = celdasEnKilos([celda({ cargaKg: 95, cargaUnidad: "lb" })]);
    // Esto es lo que hacia mal el bug: guardaba 95 tal cual con unidad "lb",
    // y desdeKilos(95, "lb") devolvia ~209 al releer. Con la conversion, el
    // kg guardado es el que corresponde a 95 lb de verdad.
    expect(r.cargaKg).not.toBe(95);
    expect(Math.round(r.cargaKg! / 0.45359237)).toBe(95);
  });

  it("null se preserva: una celda sin peso no inventa un cero", () => {
    const [r] = celdasEnKilos([celda({ cargaKg: null, objetivo: [21, 15, 9] })]);
    expect(r.cargaKg).toBeNull();
    expect(r.objetivo).toEqual([21, 15, 9]);
  });

  it("no altera divisionId, partMovementId, objetivo ni cargaUnidad", () => {
    const original = celda({
      divisionId: "elite",
      partMovementId: "thruster",
      objetivo: [10, 8, 6],
      cargaKg: 61,
      cargaUnidad: "kg",
    });
    const [r] = celdasEnKilos([original]);
    expect(r.divisionId).toBe("elite");
    expect(r.partMovementId).toBe("thruster");
    expect(r.objetivo).toEqual([10, 8, 6]);
    expect(r.cargaUnidad).toBe("kg");
  });

  it("convierte cada celda de forma independiente", () => {
    const [rx, scaled] = celdasEnKilos([
      celda({ divisionId: "rx", cargaKg: 61, cargaUnidad: "kg" }),
      celda({ divisionId: "scaled", cargaKg: 95, cargaUnidad: "lb" }),
    ]);
    expect(rx.cargaKg).toBe(61);
    expect(scaled.cargaKg).toBeCloseTo(43.09, 2);
  });
});
