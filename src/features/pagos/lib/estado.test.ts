import { describe, expect, it } from "vitest";
import { paymentStatus, textoDePaymentStatus } from "./estado";

describe("paymentStatus", () => {
  it("sin orden, no requerido", () => {
    expect(paymentStatus(null)).toBe("no_requerido");
  });

  it("una orden en $0 es no requerido, sin importar su status", () => {
    expect(paymentStatus({ status: "pendiente", amount_cents: 0 })).toBe("no_requerido");
    expect(paymentStatus({ status: "pagada", amount_cents: 0 })).toBe("no_requerido");
  });

  it("traduce cada status real", () => {
    expect(paymentStatus({ status: "pendiente", amount_cents: 1000 })).toBe("pendiente");
    expect(paymentStatus({ status: "procesando", amount_cents: 1000 })).toBe("procesando");
    expect(paymentStatus({ status: "pagada", amount_cents: 1000 })).toBe("pagado");
    expect(paymentStatus({ status: "fallida", amount_cents: 1000 })).toBe("fallido");
    expect(paymentStatus({ status: "reembolsada", amount_cents: 1000 })).toBe("reembolsado");
    expect(paymentStatus({ status: "vencida", amount_cents: 1000 })).toBe("vencido");
  });

  it("un status desconocido no revienta: queda pendiente", () => {
    expect(paymentStatus({ status: "algo_nuevo", amount_cents: 1000 })).toBe("pendiente");
  });
});

describe("textoDePaymentStatus", () => {
  it("tiene un texto para cada estado posible", () => {
    expect(textoDePaymentStatus(null)).toBe("Sin costo");
    expect(textoDePaymentStatus({ status: "pagada", amount_cents: 1000 })).toBe("Pago confirmado");
    expect(textoDePaymentStatus({ status: "procesando", amount_cents: 1000 })).toBe(
      "Pago en revisión",
    );
  });
});
