import { describe, expect, it } from "vitest";
import { errorIncluye } from "./matchError";

describe("errorIncluye", () => {
  it("encuentra el fragmento", () => {
    expect(errorIncluye("El carril ya lo tomó otro juez", "otro juez")).toBe(true);
  });

  // El caso que rompio todo al pasar los mensajes a espanol neutro.
  it("ignora las tildes de los dos lados", () => {
    expect(errorIncluye("El carril ya lo tomó otro juez", "ya lo tomo otro juez")).toBe(true);
    expect(errorIncluye("Solo el dueño puede", "dueno")).toBe(true);
    expect(errorIncluye("La competencia ya terminó", "termino")).toBe(true);
  });

  it("ignora mayusculas", () => {
    expect(errorIncluye("No Tienes Permiso", "no tienes permiso")).toBe(true);
  });

  it("acepta varios fragmentos y alcanza con uno", () => {
    expect(errorIncluye("faltan jueces", "no existe", "faltan jueces")).toBe(true);
  });

  it("devuelve false si no esta", () => {
    expect(errorIncluye("otra cosa", "faltan jueces")).toBe(false);
  });

  it("tolera mensaje vacio", () => {
    expect(errorIncluye(null, "x")).toBe(false);
    expect(errorIncluye(undefined, "x")).toBe(false);
    expect(errorIncluye("", "x")).toBe(false);
  });
});
