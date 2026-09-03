import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  manifiesto,
  parsearFirma,
  traducirEstado,
  verificarFirmaMercadoPago,
  verificarMercadoPago,
} from "./mercadopago";

const SECRETO = "clave-secreta-del-webhook";
const AHORA = 1_700_000_000_000;

beforeEach(() => {
  process.env.PAYMENTS_ENCRYPTION_KEY = "una-clave-de-prueba-de-al-menos-32-caracteres";
});

function firmar(dataId: string, requestId: string, tsSegundos: number, secreto = SECRETO) {
  const v1 = createHmac("sha256", secreto)
    .update(manifiesto(dataId, requestId, String(tsSegundos)))
    .digest("hex");
  return `ts=${tsSegundos},v1=${v1}`;
}

describe("parsearFirma", () => {
  it("lee ts y v1", () => {
    expect(parsearFirma("ts=123,v1=abc")).toEqual({ ts: "123", v1: "abc" });
  });

  it("tolera espacios", () => {
    expect(parsearFirma("ts=123, v1=abc")).toEqual({ ts: "123", v1: "abc" });
  });

  it("sin alguna de las dos, no hay firma", () => {
    expect(parsearFirma("ts=123")).toBeNull();
    expect(parsearFirma("v1=abc")).toBeNull();
    expect(parsearFirma(null)).toBeNull();
    expect(parsearFirma("cualquier cosa")).toBeNull();
  });
});

describe("manifiesto", () => {
  it("respeta el formato exacto, punto y coma finales incluidos", () => {
    // Un separador de más o de menos da otra firma. Es todo o nada.
    expect(manifiesto("123", "req-1", "1700")).toBe("id:123;request-id:req-1;ts:1700;");
  });
});

describe("verificarFirmaMercadoPago", () => {
  const base = {
    requestId: "req-1",
    dataId: "PAY-123",
    secreto: SECRETO,
    ahoraMs: AHORA,
  };

  it("acepta una firma correcta y reciente", () => {
    const ts = Math.floor(AHORA / 1000);
    const r = verificarFirmaMercadoPago({ ...base, firma: firmar("PAY-123", "req-1", ts) });
    expect(r.valida).toBe(true);
  });

  it("rechaza una firma calculada con otro secreto", () => {
    const ts = Math.floor(AHORA / 1000);
    const r = verificarFirmaMercadoPago({
      ...base,
      firma: firmar("PAY-123", "req-1", ts, "otro-secreto"),
    });
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/no coincide/i);
  });

  it("rechaza una firma de otro pago", () => {
    // Reusar la firma de un pago ajeno es el ataque más obvio.
    const ts = Math.floor(AHORA / 1000);
    const r = verificarFirmaMercadoPago({
      ...base,
      firma: firmar("PAY-OTRO", "req-1", ts),
    });
    expect(r.valida).toBe(false);
  });

  it("rechaza una firma vieja: sin ventana, una firma capturada sirve para siempre", () => {
    const ts = Math.floor((AHORA - 10 * 60 * 1000) / 1000);
    const r = verificarFirmaMercadoPago({ ...base, firma: firmar("PAY-123", "req-1", ts) });
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/ventana/i);
  });

  it("rechaza una firma del futuro", () => {
    const ts = Math.floor((AHORA + 10 * 60 * 1000) / 1000);
    const r = verificarFirmaMercadoPago({ ...base, firma: firmar("PAY-123", "req-1", ts) });
    expect(r.valida).toBe(false);
  });

  it("SIN SECRETO CONFIGURADO no acepta nada", () => {
    // La alternativa —aceptar todo mientras el organizador no configure— es
    // exactamente el agujero por el que se inscribe gratis.
    const ts = Math.floor(AHORA / 1000);
    const r = verificarFirmaMercadoPago({
      ...base,
      secreto: null,
      firma: firmar("PAY-123", "req-1", ts),
    });
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/secreta/i);
  });

  it("sin cabecera de firma no acepta nada", () => {
    expect(verificarFirmaMercadoPago({ ...base, firma: null }).valida).toBe(false);
  });

  it("sin id de pago no acepta nada", () => {
    const ts = Math.floor(AHORA / 1000);
    const r = verificarFirmaMercadoPago({
      ...base,
      dataId: null,
      firma: firmar("PAY-123", "req-1", ts),
    });
    expect(r.valida).toBe(false);
  });

  it("acepta la firma en mayúsculas", () => {
    const ts = Math.floor(AHORA / 1000);
    const firma = firmar("PAY-123", "req-1", ts).toUpperCase().replace("TS=", "ts=").replace("V1=", "v1=");
    expect(verificarFirmaMercadoPago({ ...base, firma }).valida).toBe(true);
  });
});

describe("traducirEstado", () => {
  it("solo 'approved' es un pago cobrado", () => {
    expect(traducirEstado("approved")).toBe("aprobado");
  });

  it("los estados finales negativos son rechazo", () => {
    for (const e of ["rejected", "cancelled", "refunded", "charged_back"]) {
      expect(traducirEstado(e)).toBe("rechazado");
    }
  });

  it("cualquier otra cosa queda pendiente, nunca aprobada", () => {
    for (const e of ["in_process", "authorized", "algo_nuevo", ""]) {
      expect(traducirEstado(e)).toBe("pendiente");
    }
  });
});

describe("el webhook completo", () => {
  function contexto(cuerpo: unknown, firma: string | null, requestId = "req-1") {
    const headers = new Headers();
    if (firma) headers.set("x-signature", firma);
    headers.set("x-request-id", requestId);
    return { headers, cuerpo: JSON.stringify(cuerpo), secreto: SECRETO };
  }

  it("un cuerpo que no es JSON se rechaza", async () => {
    const r = await verificarMercadoPago({
      headers: new Headers(),
      cuerpo: "no soy json",
      secreto: SECRETO,
    });
    expect(r.verificado).toBe(false);
  });

  it("una firma inválida se rechaza", async () => {
    const r = await verificarMercadoPago(
      contexto({ data: { id: "PAY-1" } }, "ts=1,v1=falsa"),
    );
    expect(r.verificado).toBe(false);
  });

  it("verificado, el estado NUNCA arranca en aprobado", async () => {
    // La notificación solo trae el id: aprobar sin consultar la API sería
    // confiar en el cuerpo del mensaje, que es justo lo que no se puede hacer.
    const ts = Math.floor(Date.now() / 1000);
    const r = await verificarMercadoPago(
      contexto({ data: { id: "PAY-1" } }, firmar("PAY-1", "req-1", ts)),
    );
    expect(r.verificado).toBe(true);
    if (r.verificado) expect(r.estado).toBe("pendiente");
  });
});
