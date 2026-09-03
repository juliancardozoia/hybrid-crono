import { describe, expect, it } from "vitest";
import { diasHasta, fechaCorta, nombreDeMes, rangoDeFechas, rangoDelMes } from "./formato";

const BOGOTA = "America/Bogota";

describe("rangoDeFechas", () => {
  it("un solo día", () => {
    expect(rangoDeFechas("2026-03-14T15:00:00Z", null, BOGOTA)).toBe("14 de marzo de 2026");
  });

  it("usa el huso del evento, no el de quien mira", () => {
    // 01:55 UTC del 15 es todavía el 14 en Bogotá. Sin huso, el catálogo
    // mostraría la competencia un día corrida.
    expect(rangoDeFechas("2026-03-15T01:55:00Z", null, BOGOTA)).toBe("14 de marzo de 2026");
    expect(rangoDeFechas("2026-03-15T01:55:00Z", null, "Europe/Madrid")).toBe(
      "15 de marzo de 2026",
    );
  });

  // El rango lo arma `Intl.formatRange`, no nosotros. Antes se componía a mano
  // ("14 al 16 de marzo"), que funcionaba en español y en ningún otro idioma.
  it("contrae el mes y el año cuando se repiten", () => {
    expect(rangoDeFechas("2026-03-14T15:00:00Z", "2026-03-16T15:00:00Z", BOGOTA)).toBe(
      "14–16 de marzo de 2026",
    );
  });

  it("un rango que cruza de mes muestra los dos meses", () => {
    expect(rangoDeFechas("2026-03-30T15:00:00Z", "2026-04-02T15:00:00Z", BOGOTA)).toBe(
      "30 de marzo – 2 de abril de 2026",
    );
  });

  it("un rango que cruza de año muestra los dos años", () => {
    expect(rangoDeFechas("2026-12-30T15:00:00Z", "2027-01-02T15:00:00Z", BOGOTA)).toBe(
      "30 de diciembre de 2026 – 2 de enero de 2027",
    );
  });

  it("cada idioma arma la fecha a su manera", () => {
    // En inglés el mes va primero y el año detrás de una coma: componerlo a
    // mano con el orden del español lo habría dejado como "14 of March 2026".
    expect(rangoDeFechas("2026-03-14T15:00:00Z", null, BOGOTA, "en")).toBe("March 14, 2026");
    expect(rangoDeFechas("2026-03-14T15:00:00Z", null, BOGOTA, "pt")).toBe("14 de março de 2026");
  });

  it("un fin igual al inicio no genera un rango", () => {
    expect(rangoDeFechas("2026-03-14T15:00:00Z", "2026-03-14T22:00:00Z", BOGOTA)).toBe(
      "14 de marzo de 2026",
    );
  });

  it("sin fecha lo dice, en vez de mostrar un hueco", () => {
    expect(rangoDeFechas(null, null, BOGOTA)).toBe("Fecha por confirmar");
    // La tarjeta prefiere una raya a una frase, que le ocuparía dos renglones.
    expect(rangoDeFechas(null, null, BOGOTA, "es", "—")).toBe("—");
  });
});

describe("fechaCorta", () => {
  it("da día y mes abreviado, en el idioma que toque", () => {
    expect(fechaCorta("2026-03-14T15:00:00Z", BOGOTA, "es")).toBe("14 mar");
    expect(fechaCorta("2026-03-14T15:00:00Z", BOGOTA, "en")).toBe("Mar 14");
  });
});

describe("diasHasta", () => {
  const dentroDe = (dias: number) =>
    new Date(Date.now() + dias * 86_400_000).toISOString();

  it("cuenta días de calendario, no bloques de 24 horas", () => {
    expect(diasHasta(new Date().toISOString(), BOGOTA)).toBe(0);
    expect(diasHasta(dentroDe(3), BOGOTA)).toBe(3);
  });

  it("una fecha pasada da negativo", () => {
    expect(diasHasta(dentroDe(-5), BOGOTA)).toBe(-5);
  });

  it("sin fecha devuelve null y no cero", () => {
    // Cero significaría "es hoy", que es exactamente lo contrario de "no sé".
    expect(diasHasta(null, BOGOTA)).toBeNull();
  });
});

describe("filtro por mes", () => {
  it("nombra el mes", () => {
    expect(nombreDeMes("2026-03")).toBe("marzo 2026");
  });

  it("el rango cubre el mes entero, incluido el último día", () => {
    // Si el último día quedara afuera, una competencia el 31 desaparecería del
    // filtro de su propio mes.
    expect(rangoDelMes("2026-03")).toEqual({ desde: "2026-03-01", hasta: "2026-03-31" });
    expect(rangoDelMes("2026-02")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(rangoDelMes("2028-02")).toEqual({ desde: "2028-02-01", hasta: "2028-02-29" });
  });

  it("una clave inválida no rompe", () => {
    expect(rangoDelMes("cualquiera")).toBeNull();
    expect(nombreDeMes("cualquiera")).toBe("cualquiera");
  });
});
