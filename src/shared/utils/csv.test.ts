import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("deja pasar lo simple sin tocarlo", () => {
    expect(csvCell("Ana")).toBe("Ana");
    expect(csvCell(42)).toBe("42");
  });

  it("entrecomilla si hay coma", () => {
    expect(csvCell("Perez, Juan")).toBe('"Perez, Juan"');
  });

  it("entrecomilla si hay punto y coma", () => {
    // Excel en locales con coma decimal usa ; como separador.
    expect(csvCell("a;b")).toBe('"a;b"');
  });

  it("duplica las comillas internas", () => {
    expect(csvCell('dice "hola"')).toBe('"dice ""hola"""');
  });

  it("entrecomilla si hay salto de linea", () => {
    expect(csvCell("linea1\nlinea2")).toBe('"linea1\nlinea2"');
  });

  it("convierte null y undefined en vacio", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("arma encabezado y filas", () => {
    const csv = toCsv(["a", "b"], [[1, 2]]);
    expect(csv).toContain("a,b\r\n1,2");
  });

  it("arranca con BOM para que Excel lea los acentos", () => {
    expect(toCsv(["nombre"], [["Pérez"]]).startsWith("\u{FEFF}")).toBe(true);
  });

  it("usa CRLF", () => {
    expect(toCsv(["a"], [["x"]])).toBe("\u{FEFF}a\r\nx\r\n");
  });

  it("sobrevive a un nombre con coma sin partir la fila", () => {
    const csv = toCsv(["dorsal", "atleta"], [[1, "Perez, Juan"]]);
    const filas = csv.replace(/^\u{FEFF}/u, "").trim().split("\r\n");
    expect(filas[1]).toBe('1,"Perez, Juan"');
  });
});
