import { describe, expect, it } from "vitest";
import { idiomaDeCorreo } from "./idioma";

describe("idiomaDeCorreo", () => {
  it("lo que eligio la persona gana", () => {
    expect(idiomaDeCorreo("pt", "en")).toBe("pt");
  });

  it("sin perfil, usa el idioma de quien la invito", () => {
    expect(idiomaDeCorreo(null, "en")).toBe("en");
    expect(idiomaDeCorreo(undefined, "pt")).toBe("pt");
  });

  it("sin ninguna pista, español", () => {
    expect(idiomaDeCorreo(null, undefined)).toBe("es");
  });

  it("un valor invalido no rompe: se ignora", () => {
    expect(idiomaDeCorreo("klingon", 42)).toBe("es");
    expect(idiomaDeCorreo("klingon", "pt")).toBe("pt");
  });
});
