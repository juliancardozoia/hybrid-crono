import { describe, expect, it } from "vitest";
import { fechaHoraEnEvento, horaEnEvento, instanteEnZona, paraInputLocal } from "./fecha";

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

describe("instanteEnZona", () => {
  it("una largada a las 20:55 en Bogotá es 01:55 UTC del día siguiente", () => {
    // Es el caso que ya mordio una vez: guardar la hora de pared como si fuera
    // UTC corre la competencia cinco horas.
    expect(instanteEnZona("2026-03-14T20:55", "America/Bogota")).toBe(
      "2026-03-15T01:55:00.000Z",
    );
  });

  it("la misma hora de pared en dos husos da dos instantes distintos", () => {
    const bogota = instanteEnZona("2026-06-01T09:00", "America/Bogota");
    const madrid = instanteEnZona("2026-06-01T09:00", "Europe/Madrid");
    expect(bogota).not.toBe(madrid);
  });

  it("acierta del lado correcto de un cambio de horario de verano", () => {
    // Madrid adelanta el reloj el 29 de marzo de 2026 a las 02:00.
    expect(instanteEnZona("2026-03-29T04:00", "Europe/Madrid")).toBe(
      "2026-03-29T02:00:00.000Z",
    );
    expect(instanteEnZona("2026-03-28T04:00", "Europe/Madrid")).toBe(
      "2026-03-28T03:00:00.000Z",
    );
  });

  it("devuelve null cuando el texto no es una fecha", () => {
    for (const basura of ["", "mañana", "2026-13-45T99:99", "2026-03-14", "2026-02-30T10:00"]) {
      expect(instanteEnZona(basura, "America/Bogota")).toBeNull();
    }
  });
});

describe("paraInputLocal", () => {
  it("es la vuelta exacta de instanteEnZona", () => {
    const local = "2026-03-14T20:55";
    const iso = instanteEnZona(local, "America/Bogota")!;
    expect(paraInputLocal(iso, "America/Bogota")).toBe(local);
  });

  it("sin fecha devuelve texto vacío, que es lo que espera un input", () => {
    expect(paraInputLocal(null, "America/Bogota")).toBe("");
  });
});
