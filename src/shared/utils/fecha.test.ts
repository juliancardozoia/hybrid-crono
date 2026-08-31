import { describe, expect, it } from "vitest";
import { fechaHoraEnEvento, horaEnEvento } from "./fecha";

/*
 * El bug real: un heat largado a las 20:55:28 en Bogota se mostraba como
 * "1:55:28" porque la pagina se renderiza en Vercel, que corre en UTC.
 */
const LARGADA_UTC = "2026-08-25T01:55:28.327803+00:00";

describe("horaEnEvento", () => {
  it("muestra la hora del venue, no la del servidor", () => {
    expect(horaEnEvento(LARGADA_UTC, "America/Bogota")).toBe("20:55:28");
  });

  it("el mismo instante da distinta hora en cada huso", () => {
    expect(horaEnEvento(LARGADA_UTC, "UTC")).toBe("01:55:28");
    expect(horaEnEvento(LARGADA_UTC, "America/Mexico_City")).toBe("19:55:28");
  });

  // Los segundos importan: es la hora que se compara contra la planilla de papel.
  it("siempre trae segundos y va en 24 horas", () => {
    expect(horaEnEvento("2026-08-25T18:05:09Z", "UTC")).toBe("18:05:09");
  });
});

describe("fechaHoraEnEvento", () => {
  it("cambia de dia si el huso lo cambia", () => {
    // 01:55 UTC del 25 son las 20:55 del 24 en Bogota.
    expect(fechaHoraEnEvento(LARGADA_UTC, "America/Bogota")).toContain("24/08/2026");
    expect(fechaHoraEnEvento(LARGADA_UTC, "UTC")).toContain("25/08/2026");
  });
});
