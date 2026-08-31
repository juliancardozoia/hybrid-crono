import { describe, expect, it } from "vitest";
import { slugify, slugWithSuffix } from "./slug";

describe("slugify", () => {
  it("pasa a minusculas y separa con guiones", () => {
    expect(slugify("Hybrid Games 2026")).toBe("hybrid-games-2026");
  });

  it("saca tildes y enes", () => {
    expect(slugify("Competencia de Bogotá")).toBe("competencia-de-bogota");
    expect(slugify("Año Nuevo")).toBe("ano-nuevo");
  });

  it("colapsa separadores y recorta los bordes", () => {
    expect(slugify("  ---Copa   Test!!!  ")).toBe("copa-test");
  });

  it("respeta el largo maximo sin dejar guion colgando", () => {
    const s = slugify("a".repeat(60), { maxLength: 10 });
    expect(s).toHaveLength(10);
    expect(s.endsWith("-")).toBe(false);
  });

  it("produce algo que la base acepta", () => {
    const patron = /^[a-z0-9-]{2,48}$/;
    expect(patron.test(slugify("Box Norte — Crossfit & Hyrox"))).toBe(true);
  });
});

describe("slugWithSuffix", () => {
  it("agrega un sufijo para desempatar", () => {
    const a = slugWithSuffix("Copa Test");
    const b = slugWithSuffix("Copa Test");
    expect(a).not.toBe(b);
    expect(a.startsWith("copa-test-")).toBe(true);
  });

  it("no se pasa del largo maximo", () => {
    expect(slugWithSuffix("x".repeat(200), 64).length).toBeLessThanOrEqual(64);
  });
});
