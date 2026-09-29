import { describe, expect, it } from "vitest";
import { firmarConSvix, razonDeSupresion, verificarEventoDeCorreo } from "./firma";

// Un secreto con la forma real de Svix: prefijo whsec_ + base64.
const SECRETO = `whsec_${Buffer.from("secreto-de-prueba-32-bytes-largo!").toString("base64")}`;
const AHORA = 1_800_000_000_000;
const TS = String(AHORA / 1000);

function evento(tipo: string, para: string[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ type: tipo, data: { to: para, ...extra } });
}

function cabecerasFirmadas(cuerpo: string, id = "msg_1", ts = TS, secreto = SECRETO) {
  return { id, timestamp: ts, firma: `v1,${firmarConSvix(secreto, id, ts, cuerpo)}` };
}

describe("verificarEventoDeCorreo", () => {
  it("acepta un evento bien firmado y devuelve sus datos", () => {
    const cuerpo = evento("email.bounced", ["Ana@Correo.com"], { bounce: { type: "Permanent" } });
    const r = verificarEventoDeCorreo(cuerpo, cabecerasFirmadas(cuerpo), SECRETO, AHORA);

    expect(r).toEqual({
      verificado: true,
      evento: { tipo: "email.bounced", destinatarios: ["ana@correo.com"], rebote: "Permanent" },
    });
  });

  it("NO verifica sin secreto configurado", () => {
    const cuerpo = evento("email.bounced", ["a@b.com"]);
    expect(verificarEventoDeCorreo(cuerpo, cabecerasFirmadas(cuerpo), undefined, AHORA).verificado).toBe(false);
  });

  it("NO verifica sin cabeceras", () => {
    const cuerpo = evento("email.bounced", ["a@b.com"]);
    const r = verificarEventoDeCorreo(cuerpo, { id: null, timestamp: null, firma: null }, SECRETO, AHORA);
    expect(r.verificado).toBe(false);
  });

  it("NO verifica una firma hecha con otro secreto", () => {
    const cuerpo = evento("email.bounced", ["victima@correo.com"]);
    const otro = `whsec_${Buffer.from("otro-secreto-completamente-distinto").toString("base64")}`;
    const r = verificarEventoDeCorreo(cuerpo, cabecerasFirmadas(cuerpo, "msg_1", TS, otro), SECRETO, AHORA);
    expect(r).toEqual({ verificado: false, motivo: "firma invalida" });
  });

  it("NO verifica si el cuerpo cambio despues de firmar", () => {
    const original = evento("email.bounced", ["a@b.com"]);
    const alterado = evento("email.bounced", ["victima@correo.com"]);
    const r = verificarEventoDeCorreo(alterado, cabecerasFirmadas(original), SECRETO, AHORA);
    expect(r.verificado).toBe(false);
  });

  it("NO verifica un mensaje viejo reenviado (fuera de la ventana de tiempo)", () => {
    const cuerpo = evento("email.bounced", ["a@b.com"]);
    const viejo = String(AHORA / 1000 - 3600);
    const r = verificarEventoDeCorreo(cuerpo, cabecerasFirmadas(cuerpo, "msg_1", viejo), SECRETO, AHORA);
    expect(r).toEqual({ verificado: false, motivo: "marca de tiempo fuera de ventana" });
  });

  it("acepta si UNA de varias firmas coincide (rotacion de secreto)", () => {
    const cuerpo = evento("email.complained", ["a@b.com"]);
    const buena = firmarConSvix(SECRETO, "msg_1", TS, cuerpo);
    const r = verificarEventoDeCorreo(
      cuerpo,
      { id: "msg_1", timestamp: TS, firma: `v1,firmaviejaquenocoincide v1,${buena}` },
      SECRETO,
      AHORA,
    );
    expect(r.verificado).toBe(true);
  });

  it("ignora versiones de firma que no conoce", () => {
    const cuerpo = evento("email.complained", ["a@b.com"]);
    const buena = firmarConSvix(SECRETO, "msg_1", TS, cuerpo);
    const r = verificarEventoDeCorreo(cuerpo, { id: "msg_1", timestamp: TS, firma: `v2,${buena}` }, SECRETO, AHORA);
    expect(r.verificado).toBe(false);
  });

  it("un cuerpo firmado pero que no es JSON no verifica", () => {
    const cuerpo = "esto no es json";
    const r = verificarEventoDeCorreo(cuerpo, cabecerasFirmadas(cuerpo), SECRETO, AHORA);
    expect(r).toEqual({ verificado: false, motivo: "cuerpo no es JSON" });
  });
});

describe("razonDeSupresion", () => {
  it("una queja suprime", () => {
    expect(razonDeSupresion({ tipo: "email.complained", destinatarios: ["a@b.com"] })).toBe("queja");
  });

  it("un rebote permanente suprime", () => {
    expect(
      razonDeSupresion({ tipo: "email.bounced", destinatarios: ["a@b.com"], rebote: "Permanent" }),
    ).toBe("bounce_permanente");
  });

  it("un rebote transitorio NO suprime: es una direccion buena con un mal momento", () => {
    expect(razonDeSupresion({ tipo: "email.bounced", destinatarios: ["a@b.com"], rebote: "Transient" })).toBeNull();
    expect(razonDeSupresion({ tipo: "email.bounced", destinatarios: ["a@b.com"] })).toBeNull();
  });

  it("otros eventos (entregado, abierto...) no hacen nada", () => {
    expect(razonDeSupresion({ tipo: "email.delivered", destinatarios: ["a@b.com"] })).toBeNull();
  });
});
