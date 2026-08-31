import { describe, expect, it } from "vitest";
import { sanitizeReturnPath } from "./redirect";

describe("sanitizeReturnPath", () => {
  it("deja pasar una ruta interna", () => {
    expect(sanitizeReturnPath("/juez")).toBe("/juez");
  });

  // El caso que motivo la funcion: el juez abre el link de su carril sin sesion
  // y despues de loguearse tiene que volver a ESE carril, no a la lista.
  it("conserva la query string", () => {
    expect(sanitizeReturnPath("/juez/carril?id=abc-123")).toBe("/juez/carril?id=abc-123");
  });

  it("rechaza una URL protocolo-relativa", () => {
    expect(sanitizeReturnPath("//sitio-malicioso.com")).toBe("/panel");
  });

  it("rechaza la variante con barra invertida", () => {
    expect(sanitizeReturnPath("/\\sitio-malicioso.com")).toBe("/panel");
  });

  it("rechaza una URL absoluta", () => {
    expect(sanitizeReturnPath("https://sitio-malicioso.com")).toBe("/panel");
  });

  it("rechaza un esquema embebido", () => {
    expect(sanitizeReturnPath("/javascript:alert(1)")).toBe("/panel");
  });

  it("cae al destino por defecto si viene vacio", () => {
    expect(sanitizeReturnPath(null)).toBe("/panel");
    expect(sanitizeReturnPath("")).toBe("/panel");
    expect(sanitizeReturnPath("   ")).toBe("/panel");
  });

  it("admite otro destino por defecto", () => {
    expect(sanitizeReturnPath(null, "/juez")).toBe("/juez");
  });
});
