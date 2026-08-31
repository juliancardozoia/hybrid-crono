import { describe, expect, it } from "vitest";
import { estaPendienteDeVerificar } from "./estado";
import type { QueueRow } from "../queries";

const fila = (parcial: Partial<QueueRow>): QueueRow => ({
  laneId: "l1",
  bib: 1,
  divisionName: "Elite",
  heatName: "Heat 1",
  status: "finished",
  totalMs: 1_449_180,
  verified: false,
  eventCount: 23,
  voidedCount: 0,
  anomalies: [],
  startedOffline: false,
  ...parcial,
});

describe("estaPendienteDeVerificar", () => {
  // El caso que motivo el indicador: un atleta termino limpio, sin ninguna
  // anomalia, y la torre de control mostraba puros ceros como si no quedara
  // nada por hacer.
  it("un carril que termino limpio sigue pendiente hasta que alguien lo verifica", () => {
    expect(estaPendienteDeVerificar(fila({ status: "finished", anomalies: [] }))).toBe(true);
  });

  it("deja de estar pendiente una vez verificado", () => {
    expect(estaPendienteDeVerificar(fila({ verified: true }))).toBe(false);
  });

  // Un atleta en la pista no es trabajo pendiente: es una carrera en curso.
  it("un carril en carrera no cuenta", () => {
    expect(estaPendienteDeVerificar(fila({ status: "running" }))).toBe(false);
    expect(estaPendienteDeVerificar(fila({ status: "idle" }))).toBe(false);
  });

  // Un DNF o un DQ tambien hay que revisarlos antes de publicar.
  it("DNF y DQ cuentan igual que una llegada", () => {
    expect(estaPendienteDeVerificar(fila({ status: "dnf" }))).toBe(true);
    expect(estaPendienteDeVerificar(fila({ status: "dq" }))).toBe(true);
  });

  // Es independiente de las anomalias: son dos preguntas distintas.
  it("no depende de que haya anomalias", () => {
    const conAnomalia = fila({ anomalies: [{ code: "split_too_fast", message: "x" }] });
    expect(estaPendienteDeVerificar(conAnomalia)).toBe(true);
    expect(estaPendienteDeVerificar({ ...conAnomalia, verified: true })).toBe(false);
  });
});
