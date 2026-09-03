import { describe, expect, it } from "vitest";
import { planDelWod, reduceWodEvents, type WodStructure } from "./wod";
import type { TimingEvent, TimingEventType } from "./types";

let seq = 0;

function marcaje(
  type: TimingEventType,
  elapsedMs: number,
  payload: Record<string, unknown> = {},
  extra: Partial<TimingEvent> = {},
): TimingEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    laneId: "c1",
    seq,
    type,
    segmentId: null,
    elapsedMs,
    payload,
    recordedBy: "juez",
    deviceId: "d1",
    clientCapturedAt: 0,
    supersedesId: null,
    voided: false,
    voidReason: null,
    ...extra,
  };
}

function reset() {
  seq = 0;
}

/** Fran: 21-15-9 de thruster y pull-up, por tiempo con cap de 10 minutos. */
function fran(): WodStructure {
  return {
    scheme: "cap",
    timeCapMs: 600_000,
    windowMs: null,
    intervalMs: null,
    blocks: [
      {
        id: "b1",
        orderIndex: 0,
        kind: "trabajo",
        rounds: 3,
        durationMs: null,
        restMs: null,
        movements: [
          {
            id: "m1",
            orderIndex: 0,
            name: "Thruster",
            unit: "reps",
            targetPerRound: [21, 15, 9],
            loadKg: 43,
            maxReps: false,
            isTiebreak: false,
          },
          {
            id: "m2",
            orderIndex: 1,
            name: "Pull-up",
            unit: "reps",
            targetPerRound: [21, 15, 9],
            loadKg: null,
            maxReps: false,
            isTiebreak: false,
          },
        ],
      },
    ],
  };
}

/** Cindy: AMRAP de 20 minutos, 5 pull-ups, 10 push-ups, 15 air squats. */
function cindy(): WodStructure {
  return {
    scheme: "ventana",
    timeCapMs: null,
    windowMs: 1_200_000,
    intervalMs: null,
    blocks: [
      {
        id: "b1",
        orderIndex: 0,
        kind: "trabajo",
        rounds: 50,
        durationMs: null,
        restMs: null,
        movements: [
          { id: "m1", orderIndex: 0, name: "Pull-up", unit: "reps", targetPerRound: [5], loadKg: null, maxReps: false, isTiebreak: false },
          { id: "m2", orderIndex: 1, name: "Push-up", unit: "reps", targetPerRound: [10], loadKg: null, maxReps: false, isTiebreak: false },
          { id: "m3", orderIndex: 2, name: "Air Squat", unit: "reps", targetPerRound: [15], loadKg: null, maxReps: false, isTiebreak: false },
        ],
      },
    ],
  };
}

/** Marca N repeticiones seguidas, una cada `paso` milisegundos. */
function reps(cantidad: number, desdeMs: number, pasoMs = 2000): TimingEvent[] {
  return Array.from({ length: cantidad }, (_, i) =>
    marcaje("rep", desdeMs + i * pasoMs, { partMovementId: "m1" }),
  );
}

describe("planDelWod", () => {
  it("despliega Fran en seis pasos con su escalera", () => {
    const plan = planDelWod(fran());
    expect(plan).toHaveLength(6);
    expect(plan.map((p) => p.target)).toEqual([21, 21, 15, 15, 9, 9]);
    expect(plan.map((p) => p.round)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(plan.map((p) => p.name)).toEqual([
      "Thruster",
      "Pull-up",
      "Thruster",
      "Pull-up",
      "Thruster",
      "Pull-up",
    ]);
  });

  it("un objetivo unico se repite en todas las rondas", () => {
    const plan = planDelWod(cindy());
    expect(plan.slice(0, 6).map((p) => p.target)).toEqual([5, 10, 15, 5, 10, 15]);
  });

  it("un chipper es un bloque de una ronda con muchos movimientos", () => {
    const chipper: WodStructure = {
      scheme: "cap",
      timeCapMs: 1_800_000,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b1",
          orderIndex: 0,
          kind: "trabajo",
          rounds: 1,
          durationMs: null,
          restMs: null,
          movements: ["Box Jump", "Pull-up", "Kettlebell Swing"].map((name, i) => ({
            id: `m${i}`,
            orderIndex: i,
            name,
            unit: "reps" as const,
            targetPerRound: [50],
            loadKg: null,
            maxReps: false,
            isTiebreak: false,
          })),
        },
      ],
    };
    const plan = planDelWod(chipper);
    expect(plan).toHaveLength(3);
    expect(plan.every((p) => p.round === 1)).toBe(true);
  });

  it("el buy-in va antes y el cash-out despues", () => {
    const conBookends: WodStructure = {
      scheme: "libre",
      timeCapMs: null,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "cash",
          orderIndex: 2,
          kind: "cash_out",
          rounds: 1,
          durationMs: null,
          restMs: null,
          movements: [{ id: "m3", orderIndex: 0, name: "Double-under", unit: "reps", targetPerRound: [50], loadKg: null, maxReps: false, isTiebreak: false }],
        },
        {
          id: "buy",
          orderIndex: 0,
          kind: "buy_in",
          rounds: 1,
          durationMs: null,
          restMs: null,
          movements: [{ id: "m1", orderIndex: 0, name: "Row", unit: "calorias", targetPerRound: [20], loadKg: null, maxReps: false, isTiebreak: false }],
        },
        {
          id: "work",
          orderIndex: 1,
          kind: "trabajo",
          rounds: 2,
          durationMs: null,
          restMs: null,
          movements: [{ id: "m2", orderIndex: 0, name: "Burpee", unit: "reps", targetPerRound: [15], loadKg: null, maxReps: false, isTiebreak: false }],
        },
      ],
    };
    const plan = planDelWod(conBookends);
    expect(plan.map((p) => p.name)).toEqual(["Row", "Burpee", "Burpee", "Double-under"]);
  });

  it("un bloque de descanso no genera pasos: es tiempo, no trabajo", () => {
    const conDescanso: WodStructure = {
      ...fran(),
      blocks: [
        ...fran().blocks,
        {
          id: "rest",
          orderIndex: 1,
          kind: "descanso",
          rounds: 1,
          durationMs: 60_000,
          restMs: null,
          movements: [],
        },
      ],
    };
    expect(planDelWod(conDescanso)).toHaveLength(6);
  });

  it("Death By: el objetivo sube de a uno por ronda", () => {
    const deathBy: WodStructure = {
      scheme: "intervalos",
      timeCapMs: null,
      windowMs: null,
      intervalMs: 60_000,
      blocks: [
        {
          id: "b1",
          orderIndex: 0,
          kind: "trabajo",
          rounds: 20,
          durationMs: 60_000,
          restMs: null,
          movements: [
            {
              id: "m1",
              orderIndex: 0,
              name: "Burpee",
              unit: "reps",
              targetPerRound: Array.from({ length: 20 }, (_, i) => i + 1),
              loadKg: null,
              maxReps: false,
              isTiebreak: false,
            },
          ],
        },
      ],
    };
    const plan = planDelWod(deathBy);
    expect(plan.map((p) => p.target).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.at(-1)!.target).toBe(20);
  });
});

describe("contar repeticiones", () => {
  it("sin marcajes, el WOD no arrancó", () => {
    reset();
    const r = reduceWodEvents("c1", [], fran());
    expect(r.status).toBe("not_started");
    expect(r.currentStepIndex).toBe(0);
    expect(r.completedReps).toBe(0);
  });

  it("cada repetición avanza el contador del paso actual", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(10, 1000)];
    const r = reduceWodEvents("c1", eventos, fran());

    expect(r.status).toBe("running");
    expect(r.currentStepIndex).toBe(0);
    expect(r.currentStepProgress).toBe(10);
    expect(r.completedReps).toBe(10);
  });

  it("al llegar al objetivo, el paso se cierra solo", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(21, 1000)];
    const r = reduceWodEvents("c1", eventos, fran());

    // El juez no da un tap extra para pasar al pull-up: llegar a 21 alcanza.
    expect(r.currentStepIndex).toBe(1);
    expect(r.currentStepProgress).toBe(0);
    expect(r.completedReps).toBe(21);
  });

  it("un no rep queda registrado y no suma", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      ...reps(5, 1000),
      marcaje("no_rep", 12_000, { partMovementId: "m1" }),
      ...reps(3, 14_000),
    ];
    const r = reduceWodEvents("c1", eventos, fran());

    expect(r.completedReps).toBe(8);
    expect(r.noRepCount).toBe(1);
  });

  it("cerrar el movimiento salta al final sin marcar cada repetición", () => {
    // Es lo que hace tolerable un chipper de 100 wall balls.
    reset();
    const eventos = [marcaje("lane_start", 0), marcaje("movement_done", 60_000, { partMovementId: "m1" })];
    const r = reduceWodEvents("c1", eventos, fran());

    expect(r.currentStepIndex).toBe(1);
    expect(r.completedReps).toBe(21);
  });

  it("cerrar el movimiento con menos de lo pedido cuenta lo que dice el juez", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 60_000, { partMovementId: "m1", cantidad: 14 }),
    ];
    const r = reduceWodEvents("c1", eventos, fran());
    expect(r.completedReps).toBe(14);
  });

  it("cerrar la ronda saltea lo que quedó sin marcar", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      ...reps(21, 1000),
      ...reps(9, 60_000),
      marcaje("round_done", 90_000),
    ];
    const r = reduceWodEvents("c1", eventos, fran());

    // Arranca la ronda 2, que en Fran es el thruster de 15.
    expect(r.currentStepIndex).toBe(2);
    expect(r.completedRounds).toBe(1);
    expect(r.completedReps).toBe(30);
  });

  it("completar todos los pasos termina el WOD", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      ...[0, 1, 2, 3, 4, 5].map((i) =>
        marcaje("movement_done", 30_000 * (i + 1), { partMovementId: `m${i}` }),
      ),
    ];
    const r = reduceWodEvents("c1", eventos, fran());

    expect(r.status).toBe("finished");
    expect(r.currentStepIndex).toBeNull();
    expect(r.finishedMs).toBe(180_000);
    // 21+21+15+15+9+9
    expect(r.completedReps).toBe(90);
  });
});

describe("AMRAP", () => {
  it("cuenta rondas enteras y las reps de la que va", () => {
    reset();
    const eventos = [marcaje("lane_start", 0)];
    // Cuatro rondas completas de Cindy.
    for (let ronda = 0; ronda < 4; ronda++) {
      for (const m of ["m1", "m2", "m3"]) {
        eventos.push(marcaje("movement_done", 60_000 * ronda + 1000, { partMovementId: m }));
      }
    }
    // Siete pull-ups de la quinta.
    eventos.push(...reps(7, 250_000));

    const r = reduceWodEvents("c1", eventos, cindy());

    expect(r.completedRounds).toBe(4);
    expect(r.repsInRound).toBe(7);
    // 4 x (5+10+15) + 7
    expect(r.completedReps).toBe(127);
  });

  it("agotar la ventana ES terminar: el score son las rondas que hizo", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(3, 1000)];
    const r = reduceWodEvents("c1", eventos, cindy(), 1_200_000);

    expect(r.status).toBe("finished");
    // No es "capeado": en un AMRAP nadie capea, todos completan la ventana.
    expect(r.capped).toBe(false);
    expect(r.stoppedAtMs).toBe(1_200_000);
  });

  it("antes de que se agote la ventana sigue corriendo", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(3, 1000)];
    const r = reduceWodEvents("c1", eventos, cindy(), 900_000);
    expect(r.status).toBe("running");
  });
});

describe("el cap", () => {
  it("se deriva del reloj, no de que alguien emita un evento", () => {
    // Si la app quedó en segundo plano cuando sonó el cap, nadie emite nada. El
    // resultado tiene que salir capeado igual.
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(15, 1000)];
    const r = reduceWodEvents("c1", eventos, fran(), 600_000);

    expect(r.capped).toBe(true);
    expect(r.status).toBe("running");
    expect(r.finishedMs).toBeNull();
    expect(r.completedReps).toBe(15);
  });

  it("quien terminó antes del cap no queda capeado", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      ...[0, 1, 2, 3, 4, 5].map((i) =>
        marcaje("movement_done", 30_000 * (i + 1), { partMovementId: `m${i}` }),
      ),
    ];
    const r = reduceWodEvents("c1", eventos, fran(), 600_000);

    expect(r.capped).toBe(false);
    expect(r.status).toBe("finished");
  });

  it("sin saber la hora, se mide contra el último marcaje", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), marcaje("rep", 700_000, { partMovementId: "m1" })];
    const r = reduceWodEvents("c1", eventos, fran());
    expect(r.capped).toBe(true);
  });

  it("una prueba sin tope nunca capea", () => {
    reset();
    const sinTope: WodStructure = { ...fran(), scheme: "libre", timeCapMs: null };
    const eventos = [marcaje("lane_start", 0), ...reps(5, 1000)];
    expect(reduceWodEvents("c1", eventos, sinTope, 9_000_000).capped).toBe(false);
  });
});

describe("carga máxima", () => {
  const cargaMaxima: WodStructure = {
    scheme: "sin_reloj",
    timeCapMs: null,
    windowMs: null,
    intervalMs: null,
    blocks: [
      {
        id: "b1",
        orderIndex: 0,
        kind: "trabajo",
        rounds: 1,
        durationMs: null,
        restMs: null,
        movements: [
          { id: "m1", orderIndex: 0, name: "Clean and Jerk", unit: "kg", targetPerRound: [1], loadKg: null, maxReps: false, isTiebreak: false },
        ],
      },
    ],
  };

  it("guarda todos los intentos y se queda con el mayor válido", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("lift", 60_000, { loadKg: 75, valido: true }),
      marcaje("lift", 180_000, { loadKg: 80, valido: true }),
      marcaje("lift", 300_000, { loadKg: 82.5, valido: false }),
    ];
    const r = reduceWodEvents("c1", eventos, cargaMaxima);

    expect(r.attempts).toHaveLength(3);
    expect(r.bestLiftKg).toBe(80);
  });

  it("un intento nulo no cuenta aunque sea el más pesado", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("lift", 60_000, { loadKg: 100, valido: false }),
      marcaje("lift", 120_000, { loadKg: 60, valido: true }),
    ];
    expect(reduceWodEvents("c1", eventos, cargaMaxima).bestLiftKg).toBe(60);
  });

  it("sin ningún intento válido no hay marca", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), marcaje("lift", 60_000, { loadKg: 100, valido: false })];
    expect(reduceWodEvents("c1", eventos, cargaMaxima).bestLiftKg).toBeNull();
  });
});

describe("el desempate", () => {
  function conHito(): WodStructure {
    const base = fran();
    base.blocks[0].movements[0].isTiebreak = true;
    return base;
  }

  it("se registra solo al cerrar el movimiento marcado, sin tap extra", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(21, 1000)];
    const r = reduceWodEvents("c1", eventos, conHito());

    // La rep 21 cierra el thruster: ese elapsed es el desempate.
    expect(r.tiebreakMs).toBe(1000 + 20 * 2000);
  });

  it("un evento de desempate explícito también sirve", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), marcaje("tiebreak", 240_000)];
    expect(reduceWodEvents("c1", eventos, fran()).tiebreakMs).toBe(240_000);
  });

  it("sin hito marcado no hay desempate", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(21, 1000)];
    expect(reduceWodEvents("c1", eventos, fran()).tiebreakMs).toBeNull();
  });
});

describe("correcciones: nada se borra", () => {
  it("un undo anula la repetición a la que apunta", () => {
    reset();
    const buena = marcaje("rep", 1000, { partMovementId: "m1" });
    const otra = marcaje("rep", 3000, { partMovementId: "m1" });
    const deshacer = marcaje("undo", 3500, {}, { supersedesId: otra.id });

    const r = reduceWodEvents("c1", [marcaje("lane_start", 0), buena, otra, deshacer], fran());
    expect(r.completedReps).toBe(1);
  });

  it("una repetición anulada por la organización no cuenta", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("rep", 1000, { partMovementId: "m1" }),
      marcaje("rep", 3000, { partMovementId: "m1" }, { voided: true, voidReason: "sin rango" }),
    ];
    expect(reduceWodEvents("c1", eventos, fran()).completedReps).toBe(1);
  });

  it("un undo huérfano produce anomalía en vez de romper el conteo", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("rep", 1000, { partMovementId: "m1" }),
      marcaje("undo", 2000, {}, { supersedesId: "no-existe" }),
    ];
    const r = reduceWodEvents("c1", eventos, fran());

    expect(r.completedReps).toBe(1);
    expect(r.anomalies.map((a) => a.code)).toContain("orphan_undo");
  });

  it("ignora marcajes de otro carril", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("rep", 1000, { partMovementId: "m1" }),
      marcaje("rep", 2000, { partMovementId: "m1" }, { laneId: "otro" }),
    ];
    expect(reduceWodEvents("c1", eventos, fran()).completedReps).toBe(1);
  });

  it("reordena marcajes que llegaron desordenados", () => {
    reset();
    const tarde = marcaje("rep", 5000, { partMovementId: "m1" });
    const temprano = marcaje("rep", 1000, { partMovementId: "m1" });
    expect(reduceWodEvents("c1", [marcaje("lane_start", 0), tarde, temprano], fran()).completedReps).toBe(2);
  });

  it("marcar de más cuando el WOD terminó produce anomalía", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      ...[0, 1, 2, 3, 4, 5].map((i) => marcaje("movement_done", 10_000 * (i + 1), { partMovementId: `m${i}` })),
      marcaje("rep", 200_000, { partMovementId: "m1" }),
    ];
    const r = reduceWodEvents("c1", eventos, fran());
    expect(r.anomalies.map((a) => a.code)).toContain("marca_sobrante");
    expect(r.status).toBe("finished");
  });
});

describe("DNF y DQ", () => {
  it("un DNF conserva lo que había hecho", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(12, 1000), marcaje("dnf", 200_000)];
    const r = reduceWodEvents("c1", eventos, fran());

    expect(r.status).toBe("dnf");
    expect(r.completedReps).toBe(12);
    expect(r.stoppedAtMs).toBe(200_000);
  });

  it("el DQ manda aunque haya terminado", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      ...[0, 1, 2, 3, 4, 5].map((i) => marcaje("movement_done", 10_000 * (i + 1), { partMovementId: `m${i}` })),
      marcaje("dq", 200_000),
    ];
    expect(reduceWodEvents("c1", eventos, fran()).status).toBe("dq");
  });

  it("el reloj se congela en el instante del abandono, no en el último parcial", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(21, 1000), marcaje("dnf", 500_000)];
    expect(reduceWodEvents("c1", eventos, fran()).stoppedAtMs).toBe(500_000);
  });
});
