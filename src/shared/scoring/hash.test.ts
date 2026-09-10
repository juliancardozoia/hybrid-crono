import { describe, expect, it } from "vitest";
import { huellaDelStanding } from "./hash";

describe("huellaDelStanding", () => {
  it("la misma lista da la misma huella", () => {
    const entradas = [
      { teamId: "a", position: 1, totalPoints: 100 },
      { teamId: "b", position: 2, totalPoints: 90 },
    ];
    expect(huellaDelStanding(entradas)).toBe(huellaDelStanding(entradas));
  });

  it("no depende del orden de entrada", () => {
    const a = [
      { teamId: "a", position: 1, totalPoints: 100 },
      { teamId: "b", position: 2, totalPoints: 90 },
    ];
    const b = [
      { teamId: "b", position: 2, totalPoints: 90 },
      { teamId: "a", position: 1, totalPoints: 100 },
    ];
    expect(huellaDelStanding(a)).toBe(huellaDelStanding(b));
  });

  it("cambiar un totalPoints en el tercer decimal cambia la huella", () => {
    const a = [{ teamId: "a", position: 1, totalPoints: 100.111 }];
    const b = [{ teamId: "a", position: 1, totalPoints: 100.112 }];
    expect(huellaDelStanding(a)).not.toBe(huellaDelStanding(b));
  });

  it("permutar dos equipos empatados (mismo puntos, posicion cambiada) cambia la huella", () => {
    const a = [
      { teamId: "a", position: 1, totalPoints: 100 },
      { teamId: "b", position: 2, totalPoints: 90 },
    ];
    const b = [
      { teamId: "a", position: 2, totalPoints: 90 },
      { teamId: "b", position: 1, totalPoints: 100 },
    ];
    expect(huellaDelStanding(a)).not.toBe(huellaDelStanding(b));
  });

  it("ruido de punto flotante no cambia la huella: 174.222 y 174.22199999999998 son la misma", () => {
    const a = [{ teamId: "a", position: 1, totalPoints: 174.222 }];
    const b = [{ teamId: "a", position: 1, totalPoints: 174.22199999999998 }];
    expect(huellaDelStanding(a)).toBe(huellaDelStanding(b));
  });

  it("una lista vacia no rompe", () => {
    expect(() => huellaDelStanding([])).not.toThrow();
  });
});
