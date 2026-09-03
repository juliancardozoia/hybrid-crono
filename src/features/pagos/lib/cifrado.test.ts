import { beforeEach, describe, expect, it } from "vitest";
import { cifrar, descifrar, firmasIguales, hayLlaveDeCifrado, pista } from "./cifrado";

const LLAVE = "una-clave-de-prueba-de-al-menos-32-caracteres";

beforeEach(() => {
  process.env.PAYMENTS_ENCRYPTION_KEY = LLAVE;
});

describe("cifrar y descifrar", () => {
  it("lo que se cifra se recupera igual", () => {
    const secreto = "sk_live_51H8xY2KzabcDEF";
    expect(descifrar(cifrar(secreto))).toBe(secreto);
  });

  it("el texto cifrado no contiene el secreto", () => {
    const secreto = "sk_live_51H8xY2KzabcDEF";
    expect(cifrar(secreto)).not.toContain(secreto);
  });

  it("cifrar dos veces lo mismo da resultados distintos", () => {
    // Con un IV fijo, dos organizadores con la misma credencial tendrían el
    // mismo texto cifrado, y eso ya filtra información.
    expect(cifrar("igual")).not.toBe(cifrar("igual"));
  });

  it("soporta acentos y caracteres raros", () => {
    const secreto = "clave-ñandú-€-🔑";
    expect(descifrar(cifrar(secreto))).toBe(secreto);
  });

  it("lleva versión, para poder rotar el algoritmo sin adivinar", () => {
    expect(cifrar("x").startsWith("v1.")).toBe(true);
  });

  it("un texto alterado NO se descifra: lanza", () => {
    // Es la diferencia entre cifrar y cifrar autenticando. Sin el tag, un byte
    // cambiado devolvería basura que después se le manda a una pasarela.
    const sobre = cifrar("sk_live_original");
    const partes = sobre.split(".");
    const datos = Buffer.from(partes[3], "base64url");
    datos[0] = datos[0] ^ 0xff;
    partes[3] = datos.toString("base64url");

    expect(() => descifrar(partes.join("."))).toThrow();
  });

  it("con otra llave no se descifra", () => {
    const sobre = cifrar("secreto");
    process.env.PAYMENTS_ENCRYPTION_KEY = "otra-clave-distinta-de-al-menos-32-caracteres";
    expect(() => descifrar(sobre)).toThrow();
  });

  it("un formato desconocido se rechaza con un mensaje legible", () => {
    expect(() => descifrar("cualquier cosa")).toThrow(/formato/i);
    expect(() => descifrar("v9.a.b.c")).toThrow(/formato/i);
  });
});

describe("sin llave configurada", () => {
  it("falla ruidosamente en vez de guardar en claro", () => {
    delete process.env.PAYMENTS_ENCRYPTION_KEY;
    expect(hayLlaveDeCifrado()).toBe(false);
    expect(() => cifrar("secreto")).toThrow(/PAYMENTS_ENCRYPTION_KEY/);
  });

  it("una llave corta tampoco sirve", () => {
    process.env.PAYMENTS_ENCRYPTION_KEY = "corta";
    expect(hayLlaveDeCifrado()).toBe(false);
    expect(() => cifrar("secreto")).toThrow();
  });
});

describe("firmasIguales", () => {
  it("reconoce dos firmas iguales", () => {
    expect(firmasIguales("abc123", "abc123")).toBe(true);
  });

  it("distingue firmas distintas", () => {
    expect(firmasIguales("abc123", "abc124")).toBe(false);
  });

  it("longitudes distintas no rompen", () => {
    expect(firmasIguales("abc", "abcdef")).toBe(false);
    expect(firmasIguales("", "x")).toBe(false);
  });
});

describe("pista", () => {
  it("muestra las puntas para que el organizador reconozca cuál cargó", () => {
    expect(pista("sk_live_51H8xY2KzabcDEF")).toBe("sk_l••••cDEF");
  });

  it("un secreto corto se oculta entero", () => {
    expect(pista("corto")).toBe("••••");
  });
});
