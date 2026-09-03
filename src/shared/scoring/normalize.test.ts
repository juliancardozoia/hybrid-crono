import { describe, expect, it } from "vitest";
import { compareComparable, escalar, normalizeScore, scorePendiente } from "./normalize";
import type { PartSpec, RawScore, ScoreDir, ScoreStatus, ScoreUnit } from "./types";

function prueba(parcial: Partial<PartSpec> = {}): PartSpec {
  return {
    id: "p1",
    orderIndex: 0,
    scoreUnit: "tiempo",
    scoreDir: "menor_gana",
    capUnit: null,
    tiebreakUnit: null,
    tiebreakDir: null,
    ...parcial,
  };
}

function score(parcial: Partial<RawScore> = {}): RawScore {
  return {
    partId: "p1",
    teamId: "t1",
    status: "valido",
    value: null,
    reps: null,
    capValue: null,
    tiebreak: null,
    ...parcial,
  };
}

describe("escalar", () => {
  it("los kilos y los metros se vuelven enteros, nunca floats", () => {
    // Un empate mal detectado por aritmetica de punto flotante no afecta a dos
    // filas: corre TODAS las posiciones de abajo.
    expect(escalar("carga", 102.5, null)).toBe(10250);
    expect(escalar("distancia", 1000.25, null)).toBe(100025);
    expect(Number.isInteger(escalar("carga", 0.1 + 0.2, null))).toBe(true);
  });

  it("dos cargas iguales escritas distinto escalan al mismo entero", () => {
    expect(escalar("carga", 61.35, null)).toBe(escalar("carga", 20.45 * 3, null));
  });

  it("rondas_reps se compara lexicografico: primero rondas, despues reps", () => {
    const cuatroRondas2 = escalar("rondas_reps", 4, 2);
    const tresRondas99 = escalar("rondas_reps", 3, 99);
    expect(cuatroRondas2).toBeGreaterThan(tresRondas99);
  });

  it("el tiempo se redondea, no se trunca", () => {
    // Truncar sesgaria todos los tiempos hacia abajo, que es la misma razon por
    // la que el reductor de circuitos redondea el elapsed.
    expect(escalar("tiempo", 1000.7, null)).toBe(1001);
  });
});

describe("normalizeScore", () => {
  it("en una prueba por tiempo, menos milisegundos da mayor valor comparable", () => {
    const parte = prueba({ scoreUnit: "tiempo", scoreDir: "menor_gana" });
    const rapido = normalizeScore(parte, score({ value: 300_000 }));
    const lento = normalizeScore(parte, score({ value: 400_000 }));
    expect(rapido.value).toBeGreaterThan(lento.value!);
  });

  it("en una prueba por reps, mas reps da mayor valor comparable", () => {
    const parte = prueba({ scoreUnit: "reps", scoreDir: "mayor_gana" });
    const muchas = normalizeScore(parte, score({ value: 180 }));
    const pocas = normalizeScore(parte, score({ value: 140 }));
    expect(muchas.value).toBeGreaterThan(pocas.value!);
  });

  it("los estados sin marca quedan incomparables", () => {
    const parte = prueba();
    const sinMarca: ScoreStatus[] = ["pendiente", "en_curso", "dnf", "dq"];
    for (const status of sinMarca) {
      expect(normalizeScore(parte, score({ status, value: 123 })).value).toBeNull();
    }
  });

  it("un score valido sin valor cargado queda incomparable en vez de valer cero", () => {
    // Valer cero lo pondria primero en una prueba por tiempo. El bug mas caro
    // posible en este modulo.
    expect(normalizeScore(prueba(), score({ value: null })).value).toBeNull();
  });

  it("normaliza el desempate segun su propia direccion", () => {
    const parte = prueba({ tiebreakUnit: "tiempo", tiebreakDir: "menor_gana" });
    const rapido = normalizeScore(parte, score({ tiebreak: 120_000 }));
    const lento = normalizeScore(parte, score({ tiebreak: 180_000 }));
    expect(rapido.tiebreak).toBeGreaterThan(lento.tiebreak!);
  });

  it("sin desempate declarado, el campo queda en null aunque venga un valor", () => {
    expect(normalizeScore(prueba(), score({ tiebreak: 5000 })).tiebreak).toBeNull();
  });
});

describe("el cap", () => {
  const conCap = prueba({
    scoreUnit: "tiempo",
    scoreDir: "menor_gana",
    capUnit: "reps",
  });

  it("quien termino le gana a quien capeo, por muchas reps que haya hecho", () => {
    // Es la regla real: quien capea rankea debajo de cualquiera que termine.
    // No hace falta ninguna constante magica que reconcilie las dos escalas:
    // el statusRank ya los separo.
    const termino = normalizeScore(conCap, score({ status: "valido", value: 1_199_000 }));
    const capeo = normalizeScore(conCap, score({ status: "capeado", capValue: 9999 }));
    expect(compareComparable(termino, capeo)).toBeLessThan(0);
  });

  it("entre dos capeados gana el que hizo mas reps", () => {
    const muchas = normalizeScore(conCap, score({ status: "capeado", capValue: 180 }));
    const pocas = normalizeScore(conCap, score({ status: "capeado", capValue: 150 }));
    expect(compareComparable(muchas, pocas)).toBeLessThan(0);
  });

  it("dos capeados con las mismas reps se desempatan por el hito", () => {
    const parte = prueba({
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
      capUnit: "reps",
      tiebreakUnit: "tiempo",
      tiebreakDir: "menor_gana",
    });
    const rapido = normalizeScore(
      parte,
      score({ status: "capeado", capValue: 150, tiebreak: 540_000 }),
    );
    const lento = normalizeScore(
      parte,
      score({ status: "capeado", capValue: 150, tiebreak: 590_000 }),
    );
    expect(compareComparable(rapido, lento)).toBeLessThan(0);
  });

  it("un capeado le gana a un DNF", () => {
    const capeo = normalizeScore(conCap, score({ status: "capeado", capValue: 10 }));
    const abandono = normalizeScore(conCap, score({ status: "dnf" }));
    expect(compareComparable(capeo, abandono)).toBeLessThan(0);
  });
});

describe("compareComparable", () => {
  const parte = prueba({ scoreUnit: "reps", scoreDir: "mayor_gana" });

  it("ordena por estado antes que por valor", () => {
    const conCap = prueba({ scoreUnit: "reps", scoreDir: "mayor_gana", capUnit: "reps" });
    const orden: ScoreStatus[] = ["valido", "capeado", "en_curso", "pendiente", "dnf", "dq"];
    const comparables = orden.map((status) =>
      normalizeScore(conCap, score({ status, value: 100, capValue: 100 })),
    );
    for (let i = 0; i + 1 < comparables.length; i++) {
      expect(compareComparable(comparables[i], comparables[i + 1])).toBeLessThan(0);
    }
  });

  it("dos scores identicos empatan de verdad: devuelve exactamente 0", () => {
    // Este 0 es lo que hace que los empatados compartan posicion y cobren los
    // mismos puntos. Si devolviera cualquier otra cosa, el empate se romperia
    // en silencio segun el orden de llegada.
    const a = normalizeScore(parte, score({ teamId: "a", value: 150 }));
    const b = normalizeScore(parte, score({ teamId: "b", value: 150 }));
    expect(compareComparable(a, b)).toBe(0);
  });

  it("dos abandonos empatan entre si", () => {
    const a = normalizeScore(parte, score({ status: "dnf" }));
    const b = normalizeScore(parte, score({ status: "dnf" }));
    expect(compareComparable(a, b)).toBe(0);
  });

  it("quien declara desempate le gana a quien no lo tiene, a igual valor", () => {
    const conHito = prueba({
      scoreUnit: "reps",
      scoreDir: "mayor_gana",
      tiebreakUnit: "tiempo",
      tiebreakDir: "menor_gana",
    });
    const marcado = normalizeScore(conHito, score({ value: 150, tiebreak: 400_000 }));
    const sinMarcar = normalizeScore(conHito, score({ value: 150, tiebreak: null }));
    expect(compareComparable(marcado, sinMarcar)).toBeLessThan(0);
  });
});

describe("scorePendiente", () => {
  it("arma un score vacio para un equipo del padron que todavia no tiene marca", () => {
    expect(scorePendiente("p1", "t9")).toEqual({
      partId: "p1",
      teamId: "t9",
      status: "pendiente",
      value: null,
      reps: null,
      capValue: null,
      tiebreak: null,
    });
  });
});

describe("cobertura de unidades", () => {
  it("las ocho unidades producen un comparable numerico en las dos direcciones", () => {
    const unidades: ScoreUnit[] = [
      "tiempo",
      "reps",
      "rondas",
      "rondas_reps",
      "carga",
      "distancia",
      "calorias",
      "puntos",
    ];
    const direcciones: ScoreDir[] = ["menor_gana", "mayor_gana"];

    for (const scoreUnit of unidades) {
      for (const scoreDir of direcciones) {
        const comparable = normalizeScore(
          prueba({ scoreUnit, scoreDir }),
          score({ value: 12, reps: 3 }),
        );
        expect(Number.isFinite(comparable.value)).toBe(true);
      }
    }
  });
});
