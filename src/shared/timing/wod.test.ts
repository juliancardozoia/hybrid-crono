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
            loadUnit: "kg",
            captureStyle: null,
            loadKg: 43,
            maxReps: false,
            isTiebreak: false, maxAttempts: 3,
          },
          {
            id: "m2",
            orderIndex: 1,
            name: "Pull-up",
            unit: "reps",
            targetPerRound: [21, 15, 9],
            loadUnit: "kg",
            captureStyle: null,
            loadKg: null,
            maxReps: false,
            isTiebreak: false, maxAttempts: 3,
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
          { id: "m1", orderIndex: 0, name: "Pull-up", unit: "reps", targetPerRound: [5], loadKg: null, maxReps: false, isTiebreak: false, maxAttempts: 3, loadUnit: "kg", captureStyle: null },
          { id: "m2", orderIndex: 1, name: "Push-up", unit: "reps", targetPerRound: [10], loadKg: null, maxReps: false, isTiebreak: false, maxAttempts: 3, loadUnit: "kg", captureStyle: null },
          { id: "m3", orderIndex: 2, name: "Air Squat", unit: "reps", targetPerRound: [15], loadKg: null, maxReps: false, isTiebreak: false, maxAttempts: 3, loadUnit: "kg", captureStyle: null },
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

/**
 * Cómo se captura cada paso.
 *
 * Antes lo decidía una función de la pantalla del juez que miraba solo la
 * UNIDAD: metros y calorías se escriben, todo lo demás se tapea. Es correcto
 * para 500 m de remo y falso para 100 double-unders — tapear cien veces le saca
 * la vista del atleta cien veces.
 */
describe("el estilo de captura de cada paso", () => {
  function unMovimiento(
    over: Partial<WodStructure["blocks"][0]["movements"][0]>,
    rondas = 1,
  ) {
    const estructura: WodStructure = {
      scheme: "cap",
      timeCapMs: 600_000,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b1",
          orderIndex: 0,
          kind: "trabajo",
          rounds: rondas,
          durationMs: null,
          restMs: null,
          movements: [
            {
              id: "m1",
              orderIndex: 0,
              name: "X",
              unit: "reps",
              targetPerRound: [10],
              loadKg: null,
              loadUnit: "kg",
              maxReps: false,
              isTiebreak: false, maxAttempts: 3,
              captureStyle: null,
              ...over,
            },
          ],
        },
      ],
    };
    return planDelWod(estructura);
  }

  it("un objetivo chico pide un toque al terminar: ya no hay umbral", () => {
    // Tapear de a uno le saca la vista del atleta al juez una vez por rep, sea
    // el objetivo 9 o 100 — y el cierre siempre pide confirmar la cantidad
    // igual, natural o por el cap. "Un toque al terminar" es el default.
    expect(unMovimiento({ targetPerRound: [21] })[0].captureStyle).toBe("hecho");
  });

  it("un objetivo grande tambien pide un toque al terminar", () => {
    // 100 double-unders no se cuentan de a uno en una pantalla.
    expect(unMovimiento({ targetPerRound: [100] })[0].captureStyle).toBe("hecho");
  });

  it("lo que no son reps se escribe: nadie tapea 500 metros", () => {
    expect(
      unMovimiento({ unit: "metros", targetPerRound: [500] })[0].captureStyle,
    ).toBe("numero");
    expect(
      unMovimiento({ unit: "calorias", targetPerRound: [30] })[0].captureStyle,
    ).toBe("numero");
  });

  it("max_reps se tapea aunque el objetivo sea enorme: contar ES el score", () => {
    expect(
      unMovimiento({ maxReps: true, targetPerRound: [999] })[0].captureStyle,
    ).toBe("tap");
  });

  it("lo que fijó el organizador gana sobre todo lo anterior", () => {
    // Su competencia, su decisión: un objetivo de 100 se puede querer contar.
    expect(
      unMovimiento({ targetPerRound: [100], captureStyle: "tap" })[0].captureStyle,
    ).toBe("tap");
    expect(
      unMovimiento({ unit: "metros", captureStyle: "tap" })[0].captureStyle,
    ).toBe("tap");
  });

  it("una escalera con objetivos muy distintos pide un toque al terminar en TODAS las rondas", () => {
    // Sin umbral, el estilo derivado ya no depende del objetivo de la ronda:
    // se mantiene uniforme sea 50 o 10.
    const plan = unMovimiento({ targetPerRound: [50, 10] }, 2);
    expect(plan.map((p) => p.target)).toEqual([50, 10]);
    expect(plan.map((p) => p.captureStyle)).toEqual(["hecho", "hecho"]);
  });
});

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
            loadUnit: "kg",
            captureStyle: null,
            loadKg: null,
            maxReps: false,
            isTiebreak: false, maxAttempts: 3,
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
          movements: [{ id: "m3", orderIndex: 0, name: "Double-under", unit: "reps", targetPerRound: [50], loadKg: null, maxReps: false, isTiebreak: false, maxAttempts: 3, loadUnit: "kg", captureStyle: null }],
        },
        {
          id: "buy",
          orderIndex: 0,
          kind: "buy_in",
          rounds: 1,
          durationMs: null,
          restMs: null,
          movements: [{ id: "m1", orderIndex: 0, name: "Row", unit: "calorias", targetPerRound: [20], loadKg: null, maxReps: false, isTiebreak: false, maxAttempts: 3, loadUnit: "kg", captureStyle: null }],
        },
        {
          id: "work",
          orderIndex: 1,
          kind: "trabajo",
          rounds: 2,
          durationMs: null,
          restMs: null,
          movements: [{ id: "m2", orderIndex: 0, name: "Burpee", unit: "reps", targetPerRound: [15], loadKg: null, maxReps: false, isTiebreak: false, maxAttempts: 3, loadUnit: "kg", captureStyle: null }],
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
              loadUnit: "kg",
              captureStyle: null,
              loadKg: null,
              maxReps: false,
              isTiebreak: false, maxAttempts: 3,
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

  it("cerrar el movimiento con MAS de lo pedido se recorta al objetivo, y queda la anomalia", () => {
    // Un juez que tipea de mas -a proposito o por error- no puede darle al
    // atleta mas reps (y por lo tanto mas puntos) de las que el WOD pide.
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 60_000, { partMovementId: "m1", cantidad: 30 }),
    ];
    const r = reduceWodEvents("c1", eventos, fran());
    expect(r.completedReps).toBe(21);
    expect(r.anomalies.some((a) => a.code === "cantidad_excede_objetivo")).toBe(true);
  });

  it("un movimiento max_reps no tiene tope: contar ES el resultado", () => {
    reset();
    const estructura = fran();
    estructura.blocks[0].rounds = 1;
    estructura.blocks[0].movements = [
      { ...estructura.blocks[0].movements[0], maxReps: true, targetPerRound: [] },
    ];
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 60_000, { partMovementId: "m1", cantidad: 250 }),
    ];
    const r = reduceWodEvents("c1", eventos, estructura);
    expect(r.completedReps).toBe(250);
    expect(r.anomalies).toEqual([]);
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

  it("el juez tiene UN cierre final para reportar cuanto llevaba, y no marca el WOD como terminado", () => {
    // Reproduce el caso real: se acabo el tiempo con el atleta a mitad del
    // ultimo movimiento (eran 9, llevaba 5). El juez tiene que poder
    // reportarlo -si no, esas 5 reps no quedan en ningun lado- pero el WOD
    // sigue sin contar como "finished": queda capeado con 5, no con 9.
    reset();
    const cierresATiempo = [0, 1, 2, 3].map((i) =>
      marcaje("movement_done", 100_000 * (i + 1), { partMovementId: `m${i}` }),
    );
    const cierreFinal = marcaje("movement_done", 640_000, {
      partMovementId: "m4",
      cantidad: 5,
    });
    // Un segundo cierre tardio, DESPUES del unico permitido: no cuenta.
    const otroTardio = marcaje("movement_done", 650_000, { partMovementId: "m5" });
    const eventos = [marcaje("lane_start", 0), ...cierresATiempo, cierreFinal, otroTardio];

    const r = reduceWodEvents("c1", eventos, fran(), 700_000);

    expect(r.status).toBe("running");
    expect(r.capped).toBe(true);
    expect(r.finishedMs).toBeNull();
    // 21+21+15+15 (los cuatro de antes) + 5 (lo que reporto el juez al cortar).
    expect(r.completedReps).toBe(77);
    expect(r.anomalies.some((a) => a.code === "marca_despues_del_limite")).toBe(true);
  });

  it("awaitingFinalTally: prende al cortar el tiempo con un paso a medias, y se apaga apenas se usa el cierre", () => {
    reset();
    // Solo 4 pasos cerrados a tiempo: el quinto (round3 m1, objetivo 9) queda
    // a medias cuando se acaba el cap.
    const cierresATiempo = [0, 1, 2, 3].map((i) =>
      marcaje("movement_done", 100_000 * (i + 1), { partMovementId: `m${i}` }),
    );
    const eventosSinCerrar = [marcaje("lane_start", 0), ...cierresATiempo];

    const antes = reduceWodEvents("c1", eventosSinCerrar, fran(), 700_000);
    expect(antes.capped).toBe(true);
    expect(antes.awaitingFinalTally).toBe(true);
    // El paso a medias sigue siendo el actual, aunque ya se acabo el tiempo:
    // es lo que le permite a la pantalla mostrar el prompt de cierre.
    expect(antes.currentStepIndex).toBe(4);

    const cierreFinal = marcaje("movement_done", 640_000, {
      partMovementId: "m4",
      cantidad: 5,
    });
    const despues = reduceWodEvents(
      "c1",
      [...eventosSinCerrar, cierreFinal],
      fran(),
      700_000,
    );
    expect(despues.awaitingFinalTally).toBe(false);
    expect(despues.capped).toBe(true);
  });

  it("awaitingFinalTally tambien prende en un AMRAP, aunque el status ya diga finished", () => {
    // "Agotar la ventana ES terminar" sigue siendo cierto -el status no
    // espera al cierre final- pero el juez igual necesita poder reportar el
    // ultimo numero antes de que la pantalla se bloquee.
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(3, 1_000)];
    const r = reduceWodEvents("c1", eventos, cindy(), 1_300_000);

    expect(r.status).toBe("finished");
    expect(r.awaitingFinalTally).toBe(true);
    expect(r.currentStepIndex).not.toBeNull();
  });

  it("el cierre final con MENOS del objetivo cuenta lo que de verdad se hizo, no el objetivo", () => {
    // Bug real, reportado en produccion: un WOD entero (Cindy, AMRAP de 3
    // minutos) donde nadie llego ni a la mitad del primer movimiento (5
    // pull-ups) mostraba "0 rondas + 5 reps" para TODOS los atletas, sin
    // importar cuantas hubieran hecho de verdad -y eso los empataba a todos
    // en el mismo puesto-. La causa: `contarRondas` sumaba el OBJETIVO de
    // cada paso ya cerrado (correcto para un `rep`, que solo cierra AL
    // llegar al objetivo) en vez de la cantidad real con la que un
    // `movement_done` lo cerro -que puede ser menor, tanto en un cierre
    // final al agotarse el tiempo como en cualquier cierre a mano.
    reset();
    // La ventana de `cindy()` es 1_200_000ms (20 min); se acaba con el primer
    // movimiento (objetivo 5) a medias, y el juez reporta 2 reps -no 5- en
    // el cierre final.
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 1_205_000, { partMovementId: "m1", cantidad: 2 }),
    ];
    const r = reduceWodEvents("c1", eventos, cindy(), 1_210_000);

    expect(r.status).toBe("finished");
    expect(r.completedRounds).toBe(0);
    expect(r.repsInRound).toBe(2);
    expect(r.completedReps).toBe(2);
  });

  it("currentRoundBreakdown dice EN CUAL movimiento quedo, no solo el total ambiguo", () => {
    // Lo que motivo agregar este campo: "3 rondas + 10 reps" no dice si esas
    // 10 son de un Push-up (objetivo 10, completo) o de un Air Squat
    // (objetivo 15, a medias). El desglose lo saca de dudas.
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      // Ronda 1 completa: Pull-up (5), Push-up (10), Air Squat (15).
      marcaje("movement_done", 30_000, { partMovementId: "m1" }),
      marcaje("movement_done", 60_000, { partMovementId: "m2" }),
      marcaje("movement_done", 90_000, { partMovementId: "m3" }),
      // Ronda 2: Pull-up completo, Push-up a medias con 6 de 10.
      marcaje("movement_done", 120_000, { partMovementId: "m1" }),
      marcaje("movement_done", 1_205_000, { partMovementId: "m2", cantidad: 6 }),
    ];
    const r = reduceWodEvents("c1", eventos, cindy(), 1_210_000);

    expect(r.completedRounds).toBe(1);
    expect(r.repsInRound).toBe(11); // 5 (Pull-up) + 6 (Push-up a medias)
    expect(r.currentRoundBreakdown).toEqual([
      { name: "Pull-up", unit: "reps", target: 5, done: 5, completo: true },
      { name: "Push-up", unit: "reps", target: 10, done: 6, completo: false },
      { name: "Air Squat", unit: "reps", target: 15, done: 0, completo: false },
    ]);
  });

  it("una ronda 2 que todavia no empezo se desglosa igual, todo en cero", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 30_000, { partMovementId: "m1" }),
      marcaje("movement_done", 60_000, { partMovementId: "m2" }),
      marcaje("movement_done", 90_000, { partMovementId: "m3" }),
    ];
    const r = reduceWodEvents("c1", eventos, cindy(), 90_000);
    expect(r.completedRounds).toBe(1);
    expect(r.currentRoundBreakdown).toEqual([
      { name: "Pull-up", unit: "reps", target: 5, done: 0, completo: false },
      { name: "Push-up", unit: "reps", target: 10, done: 0, completo: false },
      { name: "Air Squat", unit: "reps", target: 15, done: 0, completo: false },
    ]);
  });

  it("un cierre final que fuerza el ultimo paso de una ronda NO cuenta esa ronda como completa", () => {
    // Mismo defecto que el de repsInRound, encontrado al escribir los tests
    // de arriba: completedRounds contaba una ronda como terminada si el
    // ultimo paso simplemente AVANZO (stepIndex), sin chequear si llego al
    // objetivo. Un cierre final que cierra el UNICO/ULTIMO movimiento de una
    // ronda con menos de lo pedido avanza el indice igual -y con eso "parece"
    // completa- pero el atleta no la termino.
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      // Ronda 1 completa: los tres movimientos a su objetivo.
      marcaje("movement_done", 30_000, { partMovementId: "m1" }),
      marcaje("movement_done", 60_000, { partMovementId: "m2" }),
      marcaje("movement_done", 90_000, { partMovementId: "m3" }),
      // Ronda 2: dos movimientos completos, y el cierre final del tercero
      // (Air Squat, objetivo 15) con solo 6.
      marcaje("movement_done", 120_000, { partMovementId: "m1" }),
      marcaje("movement_done", 150_000, { partMovementId: "m2" }),
      marcaje("movement_done", 1_205_000, { partMovementId: "m3", cantidad: 6 }),
    ];
    const r = reduceWodEvents("c1", eventos, cindy(), 1_210_000);

    // Solo la ronda 1 esta completa: la 2 se quedo en el tercer movimiento.
    expect(r.completedRounds).toBe(1);
    expect(r.currentRoundBreakdown).toEqual([
      { name: "Pull-up", unit: "reps", target: 5, done: 5, completo: true },
      { name: "Push-up", unit: "reps", target: 10, done: 10, completo: true },
      { name: "Air Squat", unit: "reps", target: 15, done: 6, completo: false },
    ]);
  });

  it("el cierre final con MENOS del objetivo, distinto por atleta, no los empata a todos", () => {
    // Mismo bug, en los terminos exactos del reporte: cinco atletas cierran
    // el primer movimiento (objetivo 5) con cantidades DISTINTAS, y las
    // cinco tienen que quedar distintas -nunca las cinco en "5 reps".
    for (const cantidad of [1, 2, 3, 4, 2]) {
      reset();
      const eventos = [
        marcaje("lane_start", 0),
        marcaje("movement_done", 1_205_000, { partMovementId: "m1", cantidad }),
      ];
      const r = reduceWodEvents("c1", eventos, cindy(), 1_210_000);
      expect(r.repsInRound).toBe(cantidad);
    }
  });

  it("aunque el cierre final reporte el objetivo completo, el WOD NUNCA queda 'finished' si se cerro tarde", () => {
    // Es la regresion que el cierre final podria reabrir: si el ultimo
    // movimiento se cierra CON EL TIEMPO YA VENCIDO, cerrarlo con el objetivo
    // entero no lo convierte en "termino a tiempo" — sigue siendo capeado.
    reset();
    const cierresATiempo = [0, 1, 2, 3, 4].map((i) =>
      marcaje("movement_done", 100_000 * (i + 1), { partMovementId: `m${i}` }),
    );
    const cierreFinalCompleto = marcaje("movement_done", 640_000, { partMovementId: "m5" });
    const eventos = [marcaje("lane_start", 0), ...cierresATiempo, cierreFinalCompleto];

    const r = reduceWodEvents("c1", eventos, fran(), 700_000);

    expect(r.status).not.toBe("finished");
    expect(r.capped).toBe(true);
    expect(r.finishedMs).toBeNull();
    // Los seis pasos completos (21+21+15+15+9+9), pero capeado igual.
    expect(r.completedReps).toBe(90);
  });

  it("en un AMRAP, las reps despues de agotada la ventana no suman", () => {
    // Mismo principio que el cap, aplicado a la ventana: el score se congela
    // en la bocina, no en lo que el juez alcance a tapear despues.
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      ...reps(3, 1_000),
      marcaje("rep", 1_205_000, { partMovementId: "m1" }),
      marcaje("rep", 1_210_000, { partMovementId: "m1" }),
    ];

    const r = reduceWodEvents("c1", eventos, cindy(), 1_300_000);

    expect(r.status).toBe("finished");
    expect(r.capped).toBe(false); // en un AMRAP nadie "capea", todos terminan.
    expect(r.completedReps).toBe(3); // las dos reps tardias no cuentan.
    expect(r.anomalies.some((a) => a.code === "marca_despues_del_limite")).toBe(true);
  });

  it("la correccion generaliza a cualquier esquema de rondas, no solo 21-15-9", () => {
    // Helen-like: 15-12-9 de un solo movimiento. Prueba que el corte por cap
    // no depende de la estructura particular de Fran.
    reset();
    const helen: WodStructure = {
      scheme: "cap",
      timeCapMs: 300_000,
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
              name: "Kettlebell swing",
              unit: "reps",
              targetPerRound: [15, 12, 9],
              loadKg: 24,
              loadUnit: "kg",
              maxReps: false,
              isTiebreak: false, maxAttempts: 3,
              captureStyle: null,
            },
          ],
        },
      ],
    };

    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 100_000, { partMovementId: "m1" }), // cierra la de 15
      marcaje("movement_done", 200_000, { partMovementId: "m1" }), // cierra la de 12
      // Tarde (cap a los 300_000): el juez reporta que llevaba 4 de las 9.
      marcaje("movement_done", 320_000, { partMovementId: "m1", cantidad: 4 }),
    ];

    const r = reduceWodEvents("c1", eventos, helen, 400_000);

    expect(r.status).toBe("running");
    expect(r.capped).toBe(true);
    expect(r.finishedMs).toBeNull();
    expect(r.completedReps).toBe(31); // 15 + 12 + 4 (lo reportado, no el objetivo)
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
          { id: "m1", orderIndex: 0, name: "Clean and Jerk", unit: "kg", targetPerRound: [1], loadKg: null, maxReps: false, isTiebreak: false, maxAttempts: 3, loadUnit: "kg", captureStyle: null },
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

  it("sigue 'running' con intentos de sobra: la pantalla no puede cerrar sola todavía", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), marcaje("lift", 60_000, { loadKg: 75, valido: true })];
    const r = reduceWodEvents("c1", eventos, cargaMaxima);
    expect(r.status).toBe("running");
    expect(r.maxAttempts).toBe(3);
  });

  it("cierra solo al agotar los intentos, con o sin importar el reloj", () => {
    // Reportado en produccion: el juez marco 6 intentos y la pantalla nunca
    // cerro. Sin `status === "finished"`, el motor de puntuacion tampoco le
    // pone marca al carril (scoreFromWodResult exige "valido" == "finished"),
    // asi que ademas de confuso el WOD nunca puntuaba.
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("lift", 60_000, { loadKg: 75, valido: true }),
      marcaje("lift", 180_000, { loadKg: 80, valido: true }),
      marcaje("lift", 300_000, { loadKg: 82.5, valido: false }),
    ];
    const r = reduceWodEvents("c1", eventos, cargaMaxima);
    expect(r.status).toBe("finished");
    expect(r.bestLiftKg).toBe(80);
  });

  it("un cuarto intento no se descarta: queda en el log aunque ya haya cerrado", () => {
    // El reductor nunca borra nada (append-only): un intento que llega
    // despues del cierre sigue contando para bestLiftKg si es mejor, aunque
    // el carril ya este "finished". Cerrar la pantalla es responsabilidad de
    // la UI (WodJudgeScreen), no del reductor descartando datos.
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("lift", 60_000, { loadKg: 75, valido: true }),
      marcaje("lift", 180_000, { loadKg: 80, valido: true }),
      marcaje("lift", 300_000, { loadKg: 82.5, valido: false }),
      marcaje("lift", 400_000, { loadKg: 85, valido: true }),
    ];
    const r = reduceWodEvents("c1", eventos, cargaMaxima);
    expect(r.status).toBe("finished");
    expect(r.attempts).toHaveLength(4);
    expect(r.bestLiftKg).toBe(85);
  });

  it("un movimiento sin tope configurado (esquema distinto) no reporta maxAttempts", () => {
    reset();
    const eventos = [marcaje("lane_start", 0), ...reps(21, 1000)];
    expect(reduceWodEvents("c1", eventos, fran()).maxAttempts).toBeNull();
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

/**
 * "10 devil press, max cal bike" — AMRAP de 3 min. Replay exacto de un caso
 * real reportado en produccion (CrossFit Session #2, WOD #2): el score
 * mostraba 90 y 100 en vez de las 80 y 90 calorias que de verdad se hicieron,
 * porque `completedReps` sumaba las 10 reps fijas del devil press junto con
 * las calorias de la bici. `completedByUnit` es lo que le permite a
 * `fromTiming.ts` tomar solo la unidad que la prueba puntua.
 */
function devilPressYBici(): WodStructure {
  return {
    scheme: "ventana",
    timeCapMs: null,
    windowMs: 180_000,
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
          {
            id: "m1", orderIndex: 0, name: "Devil Press", unit: "reps",
            targetPerRound: [10], loadKg: 5.44, loadUnit: "lb",
            maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3,
          },
          {
            id: "m2", orderIndex: 1, name: "Bike", unit: "calorias",
            targetPerRound: [0], loadKg: null, loadUnit: "kg",
            maxReps: true, isTiebreak: false, captureStyle: null, maxAttempts: 3,
          },
        ],
      },
    ],
  };
}

describe("un buy-in de reps fijas mezclado con un movimiento abierto de otra unidad", () => {
  it("completedByUnit separa las 10 reps de las 80 calorías; completedReps las sigue sumando", () => {
    reset();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 62_902, { round: 1, partMovementId: "m1" }),
      marcaje("movement_done", 185_836, { round: 1, cantidad: 80, partMovementId: "m2" }),
    ];
    const r = reduceWodEvents("c1", eventos, devilPressYBici(), 185_836);

    expect(r.status).toBe("finished");
    expect(r.completedReps).toBe(90); // 10 + 80: la suma cruda, sin discriminar.
    expect(r.completedByUnit).toEqual({ reps: 10, calorias: 80 });
  });
});

// ---------------------------------------------------------------------------
// Bloques de descanso OBLIGATORIO dentro de un solo For Time.
//
// Es el caso real reportado: "30 clean and jerk, cap 8 min, descanso 1 min,
// thruster por tiempo sin cap" como UNA sola prueba (un solo score, un solo
// puesto), no partida en Parte A / Parte B -que tenia el reloj de la Parte B
// midiendose desde la largada del heat, no desde que arrancaba esa parte-.
// ---------------------------------------------------------------------------

describe("un For Time con un bloque de descanso obligatorio en el medio", () => {
  /**
   * "30 Clean & Jerk, cap 8 min (480_000ms) - descanso 1 min (60_000ms) -
   * Thruster por tiempo, sin cap propio."
   */
  function cleanJerkDescansoThruster(): WodStructure {
    return {
      scheme: "cap",
      timeCapMs: null,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "bA",
          orderIndex: 0,
          kind: "trabajo",
          rounds: 1,
          durationMs: null,
          restMs: null,
          capMs: 480_000,
          movements: [
            {
              id: "cj", orderIndex: 0, name: "Clean and Jerk", unit: "reps",
              targetPerRound: [30], loadKg: null, loadUnit: "kg",
              maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3,
            },
          ],
        },
        {
          id: "bR",
          orderIndex: 1,
          kind: "descanso",
          rounds: 1,
          durationMs: 60_000,
          restMs: null,
          movements: [],
        },
        {
          id: "bB",
          orderIndex: 2,
          kind: "trabajo",
          rounds: 1,
          durationMs: null,
          restMs: null,
          capMs: null, // sin cap propio: corre hasta que termina.
          movements: [
            {
              id: "th", orderIndex: 0, name: "Thruster", unit: "reps",
              targetPerRound: [21], loadKg: null, loadUnit: "kg",
              maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3,
            },
          ],
        },
      ],
    };
  }

  it("REGLA NUEVA: si A termina antes del cap, el descanso NO arranca ya -espera al cap nominal, sin mostrar cuenta regresiva-", () => {
    // Reportado en produccion: un atleta que terminaba las 30 reps antes de
    // tiempo hacia arrancar el descanso YA, con lo cual le sobraba descanso.
    // Para la organizacion el descanso siempre corresponde al cap del bloque
    // anterior (aca, el minuto 8 de A), nunca a cuando el atleta termino de
    // verdad.
    reset();
    const estructura = cleanJerkDescansoThruster(); // A: cap 480_000. Descanso: 60_000.
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 300_000, { cantidad: 30, partMovementId: "cj" }), // termina en 5 min, bien antes del cap de 8.
    ];

    // Bloqueado -no hay nada que marcar- pero SIN cuenta regresiva: el
    // descanso real todavia no arranco.
    const esperando = reduceWodEvents("c1", eventos, estructura, 320_000);
    expect(esperando.enDescanso).toBe(true);
    expect(esperando.descansoTerminaMs).toBeNull();
    expect(esperando.capped).toBe(false);
    expect(esperando.status).toBe("running");

    // Recien al cumplirse el cap de A (480_000) arranca el descanso DE
    // VERDAD, y ahi si aparece la cuenta regresiva: 480_000 + 60_000.
    const enDescansoReal = reduceWodEvents("c1", eventos, estructura, 490_000);
    expect(enDescansoReal.enDescanso).toBe(true);
    expect(enDescansoReal.descansoTerminaMs).toBe(540_000);

    // El descanso ya termino: el reductor avanzo SOLO al bloque B, sin que
    // nadie emita ningun evento de "arranca B".
    const terminoDescanso = reduceWodEvents("c1", eventos, estructura, 541_000);
    expect(terminoDescanso.enDescanso).toBe(false);
    expect(terminoDescanso.status).toBe("running");
    expect(terminoDescanso.currentStepIndex).toBe(1); // el paso del Thruster.

    // B se completa a las 21 reps, bien despues del descanso.
    const eventosCompletos = [
      ...eventos,
      marcaje("movement_done", 700_000, { cantidad: 21, partMovementId: "th" }),
    ];
    const r = reduceWodEvents("c1", eventosCompletos, estructura, 700_000);
    expect(r.status).toBe("finished");
    expect(r.capped).toBe(false);
    expect(r.finishedMs).toBe(700_000);
    expect(r.completedReps).toBe(51); // 30 + 21.
  });

  it("REGLA NUEVA: mientras se espera el numero, el reloj se congela en el CAP -no sigue corriendo en vivo-", () => {
    // Reportado en produccion: la pantalla seguia mostrando tiempo en vivo
    // mientras esperaba que el juez escribiera cuanto habia hecho, en vez de
    // congelarse en el cap como ya hace el reductor de un solo bloque.
    reset();
    const estructura = cleanJerkDescansoThruster(); // A: cap 480_000.
    const eventos = [marcaje("lane_start", 0)];

    // Pasaron 30 segundos desde que se cumplio el cap y el juez todavia no
    // registro nada.
    const esperando = reduceWodEvents("c1", eventos, estructura, 510_000);
    expect(esperando.awaitingFinalTally).toBe(true);
    // Se congela en el CAP (480_000), no en el elapsed "en vivo" (510_000).
    expect(esperando.stoppedAtMs).toBe(480_000);
  });

  it("NO completa las 30 de A a tiempo: pide el cierre final, y desde ahi el WOD entero queda capeado", () => {
    reset();
    const estructura = cleanJerkDescansoThruster();
    const eventos = [marcaje("lane_start", 0)];

    // Se cumplieron los 8 minutos del bloque A y el juez todavia no cerro.
    const capeando = reduceWodEvents("c1", eventos, estructura, 480_000);
    expect(capeando.awaitingFinalTally).toBe(true);
    expect(capeando.enDescanso).toBe(false); // no se entra al descanso sin el cierre.
    expect(capeando.currentStepIndex).toBe(0);

    // El juez reporta que el atleta iba en 22 de 30.
    const eventosConCierre = [
      ...eventos,
      marcaje("movement_done", 480_000, { cantidad: 22, partMovementId: "cj" }),
    ];
    const cerrado = reduceWodEvents("c1", eventosConCierre, estructura, 480_000);
    expect(cerrado.awaitingFinalTally).toBe(false);
    expect(cerrado.capped).toBe(true);
    // El descanso arranca DESDE EL CIERRE (480_000), no desde el tope teorico
    // -aunque en este caso coinciden porque el cierre se dio justo al tope-.
    expect(cerrado.enDescanso).toBe(true);
    expect(cerrado.descansoTerminaMs).toBe(540_000);
    // BUG REAL reportado en produccion: justo aca, con el atleta recien
    // entrando al descanso, `capped` ya es true pero TODAVIA falta el
    // descanso y la Parte B. Si `sinNadaMasQueMarcar` fuera true en este
    // momento, `scoreFromWodResult` escribiria "capeado" (TERMINAL) y
    // `actualizarCierreDeHeat` cerraria el heat entero antes de tiempo.
    expect(cerrado.sinNadaMasQueMarcar).toBe(false);

    // Termina el descanso, y el atleta SIGUE: hace las 21 de B completas.
    const eventosCompletos = [
      ...eventosConCierre,
      marcaje("movement_done", 800_000, { cantidad: 21, partMovementId: "th" }),
    ];
    const r = reduceWodEvents("c1", eventosCompletos, estructura, 800_000);

    // La decision de producto: aunque el atleta termino TODO lo que seguia,
    // la prueba entera queda capeada porque A no llego a tiempo. El score son
    // las reps totales acumuladas (22 + 21), nunca un tiempo de llegada.
    expect(r.status).toBe("finished"); // no queda nada mas que marcar...
    expect(r.capped).toBe(true); // ...pero es capeado, no valido.
    expect(r.finishedMs).toBeNull();
    expect(r.completedReps).toBe(43); // 22 + 21.
    // Ahora SI: recien termino todo, recien es seguro tratarlo como terminal.
    expect(r.sinNadaMasQueMarcar).toBe(true);
  });

  it("REGLA NUEVA: si el juez cierra TARDE (reaccion), el descanso arranca desde el CAP NOMINAL, no desde cuando de verdad cerro", () => {
    // El descanso "corresponde" al bloque anterior: siempre arranca al
    // cumplirse SU cap, nunca despues -ni cuando el atleta termina antes, ni
    // cuando el juez tarda de mas en registrar el cierre forzado-. Sin esto,
    // la demora de reaccion del juez le come minutos al horario del bloque
    // siguiente en vez de comerle, como mucho, unos segundos a SU PROPIO
    // descanso.
    reset();
    const estructura = cleanJerkDescansoThruster(); // A: cap 480_000.
    // El juez se distrajo: cierra recien a los 9 minutos, un minuto despues
    // del cap de 8.
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 540_000, { cantidad: 25, partMovementId: "cj" }),
    ];
    const r = reduceWodEvents("c1", eventos, estructura, 545_000);
    expect(r.capped).toBe(true);
    // El descanso (480_000 a 540_000) YA TERMINO para cuando el juez cerro
    // -cerro justo en el segundo 540_000, el mismo instante en que el
    // descanso nominal se acaba- asi que a esta altura ya esta en el bloque
    // B, no en descanso.
    expect(r.enDescanso).toBe(false);
    expect(r.descansoTerminaMs).toBeNull();
    expect(r.currentStepIndex).toBe(1); // Thruster, ya habilitado.

    // Con una demora mas corta, el descanso SI se alcanza a ver: cierra a
    // los 8:03 (483_000, 3s de demora), bien dentro del descanso nominal
    // 480_000-540_000.
    reset();
    const eventosCortos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 483_000, { cantidad: 25, partMovementId: "cj" }),
    ];
    const r2 = reduceWodEvents("c1", eventosCortos, estructura, 485_000);
    expect(r2.enDescanso).toBe(true);
    // 480_000 (el CAP NOMINAL) + 60_000, no 483_000 (cuando de verdad cerro).
    expect(r2.descansoTerminaMs).toBe(540_000);
  });

  it("una marca que llega DURANTE el descanso no cuenta y queda como anomalia", () => {
    reset();
    const estructura = cleanJerkDescansoThruster();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 300_000, { cantidad: 30, partMovementId: "cj" }),
      // Alguien tapea durante el descanso (300_000 a 360_000).
      marcaje("rep", 330_000, { partMovementId: "th" }),
    ];
    const r = reduceWodEvents("c1", eventos, estructura, 330_000);
    expect(r.enDescanso).toBe(true);
    expect(r.completedReps).toBe(30); // el tap del descanso no sumo nada.
    expect(r.anomalies.some((a) => a.code === "marca_durante_descanso")).toBe(true);
  });

  it("DNF durante el bloque B manda sobre todo lo demas", () => {
    reset();
    const estructura = cleanJerkDescansoThruster();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 300_000, { cantidad: 30, partMovementId: "cj" }),
      marcaje("movement_done", 500_000, { cantidad: 10, partMovementId: "th" }),
      marcaje("dnf", 500_000),
    ];
    const r = reduceWodEvents("c1", eventos, estructura, 500_000);
    expect(r.status).toBe("dnf");
    expect(r.stoppedAtMs).toBe(500_000);
  });

  it("sin ningun bloque de descanso, el esquema 'cap'/'libre' sigue el camino de siempre (cero cambio de comportamiento)", () => {
    reset();
    // Fran, tal cual, no tiene bloques de descanso: tiene que dar EXACTAMENTE
    // lo mismo que antes de este cambio.
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("rep", 60_000, { round: 1, partMovementId: "m1" }),
    ];
    const r = reduceWodEvents("c1", eventos, fran(), 60_000);
    expect(r.enDescanso).toBe(false);
    expect(r.descansoTerminaMs).toBeNull();
    expect(r.status).toBe("running");
  });

  it("compatibilidad: un bloque de trabajo SIN capMs propio hereda el timeCapMs de la PARTE si es el primero", () => {
    // Este es el patron que ya usaba WodJudgeScreen para el descanso ENTRE
    // partes -Parte A con un solo bloque de trabajo mas un descanso, capeada
    // por el `timeCapMs` de la parte, sin `capMs` en el bloque-. No puede
    // dejar de funcionar: es el unico caso real en produccion hoy.
    reset();
    const estructura: WodStructure = {
      scheme: "cap",
      timeCapMs: 8_000,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b1", orderIndex: 0, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          // Sin capMs: tiene que heredar los 8_000 de `timeCapMs`.
          movements: [
            { id: "m1", orderIndex: 0, name: "Clean and Jerk", unit: "reps", targetPerRound: [30], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
        { id: "r1", orderIndex: 1, kind: "descanso", rounds: 1, durationMs: 30_000, restMs: null, movements: [] },
      ],
    };
    const eventos = [marcaje("lane_start", 0)];
    // Ya pasaron los 8s del cap heredado.
    const r = reduceWodEvents("c1", eventos, estructura, 12_000);
    expect(r.awaitingFinalTally).toBe(true);
  });

  it("tres bloques de trabajo con dos descansos: cada descanso arranca del CAP NOMINAL del bloque anterior, no de cuando cerro de verdad", () => {
    reset();
    const estructura: WodStructure = {
      scheme: "libre",
      timeCapMs: null,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b1", orderIndex: 0, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          capMs: 120_000,
          movements: [
            { id: "m1", orderIndex: 0, name: "A", unit: "reps", targetPerRound: [10], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
        { id: "r1", orderIndex: 1, kind: "descanso", rounds: 1, durationMs: 30_000, restMs: null, movements: [] },
        {
          id: "b2", orderIndex: 2, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          capMs: 120_000,
          movements: [
            { id: "m2", orderIndex: 0, name: "B", unit: "reps", targetPerRound: [10], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
        { id: "r2", orderIndex: 3, kind: "descanso", rounds: 1, durationMs: 15_000, restMs: null, movements: [] },
        {
          id: "b3", orderIndex: 4, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          capMs: null,
          movements: [
            { id: "m3", orderIndex: 0, name: "C", unit: "reps", targetPerRound: [10], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
      ],
    };

    // b1: cap 120_000, cierra ANTES (100_000) -> r1 arranca en el NOMINAL
    // 120_000, no en 100_000, y dura hasta 150_000.
    // b2: unlocked en 150_000, cap propio 120_000 -> su nominal es
    // 150_000+120_000=270_000. Cierra antes (200_000) -> r2 arranca en
    // 270_000 (NOMINAL), dura 15_000, hasta 285_000.
    // b3: sin cap, ultimo segmento -> unlocked en 285_000, cierra apenas se
    // marca, sin esperar nada mas.
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 100_000, { cantidad: 10, partMovementId: "m1" }),
      marcaje("movement_done", 200_000, { cantidad: 10, partMovementId: "m2" }),
      marcaje("movement_done", 300_000, { cantidad: 10, partMovementId: "m3" }),
    ];

    // A los 110_000 -b1 ya cerro (100_000) pero su cap nominal (120_000)
    // todavia no se cumplio-: bloqueado, pero SIN cuenta regresiva todavia
    // -el descanso real de r1 ni arranco-.
    const antesDeHora = reduceWodEvents("c1", eventos.slice(0, 2), estructura, 110_000);
    expect(antesDeHora.enDescanso).toBe(true);
    expect(antesDeHora.descansoTerminaMs).toBeNull(); // todavia esperando el cap nominal de b1 (120_000).

    const r = reduceWodEvents("c1", eventos, estructura, 300_000);
    expect(r.status).toBe("finished");
    expect(r.capped).toBe(false);
    expect(r.completedReps).toBe(30);
    expect(r.finishedMs).toBe(300_000);
  });

  it("REGRESION de produccion: bloque 1 capea con DOS movimientos en el bloque 2 (15-12-9 de dos ejercicios) — no queda 'atascado'", () => {
    // Reproduce EXACTAMENTE la configuracion real de CrossFit Session #1:
    // 30 Clean & Jerk (cap 3 min) - descanso 1 min - 15-12-9 de Crossover Y
    // Handstand Push-up (cap 4 min, dos movimientos por ronda). El bug real:
    // el juez registro el cierre del bloque 1 (25 de 30) y la pantalla saltaba
    // directo a "CAPEADO", sin pasar por el descanso ni ofrecer el Crossover.
    reset();
    const estructura: WodStructure = {
      scheme: "cap",
      timeCapMs: 480_000,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b0", orderIndex: 0, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          capMs: 180_000,
          movements: [
            { id: "cj", orderIndex: 0, name: "Clean and Jerk", unit: "reps", targetPerRound: [30], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
        { id: "b1", orderIndex: 1, kind: "descanso", rounds: 1, durationMs: 60_000, restMs: null, movements: [] },
        {
          id: "b2", orderIndex: 2, kind: "trabajo", rounds: 3, durationMs: null, restMs: null,
          capMs: 240_000,
          movements: [
            { id: "crossover", orderIndex: 0, name: "Crossover", unit: "reps", targetPerRound: [15, 12, 9], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
            { id: "hspu", orderIndex: 1, name: "Handstand Push-up", unit: "reps", targetPerRound: [15, 12, 9], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
      ],
    };

    const eventos = [
      marcaje("lane_start", 0),
      // El juez registra 25 de 30 unos segundos despues del cap de 3 min.
      marcaje("movement_done", 190_747, { cantidad: 25, partMovementId: "cj" }),
    ];

    const justoDespues = reduceWodEvents("c1", eventos, estructura, 191_000);
    expect(justoDespues.capped).toBe(true);
    expect(justoDespues.enDescanso).toBe(true);
    // El descanso arranca del CAP NOMINAL (180_000), no de cuando el juez
    // de verdad registro el cierre (190_747): 180_000 + 60_000 = 240_000.
    expect(justoDespues.descansoTerminaMs).toBe(240_000);
    // ESTO es lo que estaba mal: sin el fix, esto daba `true` y el score
    // quedaba "capeado" (terminal) mientras el atleta todavia tenia que
    // descansar y hacer el Crossover/HSPU.
    expect(justoDespues.sinNadaMasQueMarcar).toBe(false);
    // Apunta al primer paso del bloque 2 (Crossover, ronda 1), no a null.
    expect(justoDespues.currentStepIndex).toBe(1);

    const terminoElDescanso = reduceWodEvents("c1", eventos, estructura, 241_000);
    expect(terminoElDescanso.enDescanso).toBe(false);
    expect(terminoElDescanso.sinNadaMasQueMarcar).toBe(false); // sigue sin terminar: falta marcar el Crossover.
    expect(terminoElDescanso.status).toBe("running");
    expect(terminoElDescanso.currentStepIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// El tope GENERAL: "WOD con cap de 8 minutos" tiene que incluir el bloque 1,
// el descanso Y el bloque 2 -no dejar que el conjunto se pase de los 8
// minutos solo porque cada bloque respeta el suyo por separado-.
// ---------------------------------------------------------------------------

describe("el tope general de la prueba entera (bloque + descanso + bloque, todo dentro de un cap)", () => {
  /** Bloque 1 cap 3 min, descanso 1 min, bloque 2 cap 4 min, TODO dentro de un cap general de 8 min. */
  function conTopeGeneral(): WodStructure {
    return {
      scheme: "cap",
      timeCapMs: 480_000, // 8 min: el techo de TODO el conjunto.
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b0", orderIndex: 0, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          capMs: 180_000, // 3 min.
          movements: [
            { id: "cj", orderIndex: 0, name: "Clean and Jerk", unit: "reps", targetPerRound: [30], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
        { id: "b1", orderIndex: 1, kind: "descanso", rounds: 1, durationMs: 60_000, restMs: null, movements: [] }, // 1 min.
        {
          id: "b2", orderIndex: 2, kind: "trabajo", rounds: 3, durationMs: null, restMs: null,
          capMs: 240_000, // 4 min propios -pero el tope general puede recortarlos-.
          movements: [
            { id: "cr", orderIndex: 0, name: "Crossover", unit: "reps", targetPerRound: [15, 12, 9], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
            { id: "hs", orderIndex: 1, name: "Handstand Push-up", unit: "reps", targetPerRound: [15, 12, 9], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
      ],
    };
  }

  it("si todo va justo al tiempo (bloque 1 cierra EXACTO a los 3:00), el bloque 2 tiene sus 4 minutos completos", () => {
    reset();
    const estructura = conTopeGeneral();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 180_000, { cantidad: 28, partMovementId: "cj" }),
    ];
    // El descanso deberia terminar a los 240_000, sin recorte -3min+1min=4min,
    // y el tope general (8min=480_000) todavia deja los 4 min completos de b2.
    const r = reduceWodEvents("c1", eventos, estructura, 200_000);
    expect(r.enDescanso).toBe(true);
    expect(r.descansoTerminaMs).toBe(240_000);
  });

  it("MISCONFIGURACION: si el cap general declarado es MENOR que la suma de los bloques, el tope general manda igual", () => {
    // Con la regla nueva -cada bloque arranca siempre en el cap NOMINAL del
    // anterior- la demora de reaccion del juez ya no le come minutos al
    // horario (ver el describe de "cierra TARDE" mas arriba). El tope
    // general sigue haciendo falta para el caso en que el organizador
    // declaro un cap general que NO alcanza para lo que sus propios bloques
    // suman: 3 min + 1 min + 4 min = 8 min, pero si el cap general quedo
    // cargado en, por ejemplo, 6:40 (400_000ms), eso tiene que ganar.
    reset();
    const estructura: WodStructure = {
      ...conTopeGeneral(),
      timeCapMs: 400_000, // mal cargado: los bloques suman 480_000.
    };
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 180_000, { cantidad: 28, partMovementId: "cj" }), // cierra justo al cap propio.
    ];
    // Descanso 180_000-240_000: el tope general (400_000) no llega tan lejos
    // todavia, asi que corre completo.
    const enDescanso = reduceWodEvents("c1", eventos, estructura, 200_000);
    expect(enDescanso.descansoTerminaMs).toBe(240_000);

    // El bloque 2 "deberia" tener hasta 240_000+240_000=480_000 con su propio
    // cap -pero el tope GENERAL es 400_000, bastante antes-. Ahi tiene que
    // pedir su cierre final, no a los 480_000.
    const alTopeGeneral = reduceWodEvents("c1", eventos, estructura, 400_000);
    expect(alTopeGeneral.enDescanso).toBe(false); // ya esta en el bloque 2.
    expect(alTopeGeneral.awaitingFinalTally).toBe(true);
    expect(alTopeGeneral.currentStepIndex).toBe(1); // Crossover, todavia nada marcado.

    // Si nadie hace nada, a los 480_000 (el cap "propio" del bloque 2, que ya
    // paso el tope general) el cierre final YA tuvo que haberse pedido antes.
    const masAlla = reduceWodEvents("c1", eventos, estructura, 480_000);
    expect(masAlla.awaitingFinalTally).toBe(true); // sigue esperando el cierre, no broto solo.
  });

  it("el juez SI puede cerrar el bloque 2 justo en el tope general, y ahi la prueba queda capeada con lo acumulado", () => {
    reset();
    const estructura: WodStructure = {
      ...conTopeGeneral(),
      timeCapMs: 400_000,
    };
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 180_000, { cantidad: 28, partMovementId: "cj" }),
      // Cierra el bloque 2 (Crossover, la ronda 1 a medias) justo al tope general.
      marcaje("movement_done", 400_000, { cantidad: 10, partMovementId: "cr" }),
    ];
    const r = reduceWodEvents("c1", eventos, estructura, 400_000);
    expect(r.awaitingFinalTally).toBe(false);
    expect(r.capped).toBe(true);
    expect(r.completedReps).toBe(38); // 28 + 10.
    expect(r.sinNadaMasQueMarcar).toBe(true); // el tope general no deja nada mas por delante.
    expect(r.status).toBe("finished");
    // REGRESION real: esto NO es un descanso -es el ULTIMO bloque de la
    // prueba, capeado, sin nada mas despues-. La pantalla tiene que mostrar
    // el resumen de cierre (CAPEADO + las reps), nunca "Descanso obligatorio".
    expect(r.enDescanso).toBe(false);
    // El reloj congelado muestra el CAP (400_000), no "cap + lo que tardo el
    // juez en escribir el numero" -en este caso coinciden porque el juez
    // registro justo al tope, se prueba la demora abajo-.
    expect(r.stoppedAtMs).toBe(400_000);
  });

  it("REGRESION: si el juez tarda en registrar el cierre del ULTIMO bloque, el reloj congelado muestra el CAP, no el momento real del registro", () => {
    reset();
    const estructura: WodStructure = {
      ...conTopeGeneral(),
      timeCapMs: 400_000,
    };
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 180_000, { cantidad: 28, partMovementId: "cj" }),
      // El juez tarda 12 segundos de mas en registrar el cierre del bloque 2.
      marcaje("movement_done", 412_000, { cantidad: 10, partMovementId: "cr" }),
    ];
    const r = reduceWodEvents("c1", eventos, estructura, 412_000);
    expect(r.status).toBe("finished");
    expect(r.enDescanso).toBe(false); // resumen de cierre, no "Descanso obligatorio".
    // 400_000 (el CAP), NUNCA 412_000 (cuando de verdad se registro).
    expect(r.stoppedAtMs).toBe(400_000);
  });
});

// ---------------------------------------------------------------------------
// Un cierre tiene que ser DEL MOVIMIENTO QUE TOCA, no de cualquiera.
// ---------------------------------------------------------------------------

describe("un movement_done que apunta a OTRO movimiento no cierra el paso actual", () => {
  /** Reproduce EXACTO el bug real: Clean & Jerk (cap 3) - descanso 1 - Crossover+HSPU 15-12-9 (cap 4). */
  function estructuraReal(): WodStructure {
    return {
      scheme: "cap",
      timeCapMs: 480_000,
      windowMs: null,
      intervalMs: null,
      blocks: [
        {
          id: "b0", orderIndex: 0, kind: "trabajo", rounds: 1, durationMs: null, restMs: null,
          capMs: 180_000,
          movements: [
            { id: "cj", orderIndex: 0, name: "Clean and Jerk", unit: "reps", targetPerRound: [30], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
        { id: "b1", orderIndex: 1, kind: "descanso", rounds: 1, durationMs: 60_000, restMs: null, movements: [] },
        {
          id: "b2", orderIndex: 2, kind: "trabajo", rounds: 3, durationMs: null, restMs: null,
          capMs: 240_000,
          movements: [
            { id: "cr", orderIndex: 0, name: "Crossover", unit: "reps", targetPerRound: [15, 12, 9], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
            { id: "hs", orderIndex: 1, name: "Handstand Push-up", unit: "reps", targetPerRound: [15, 12, 9], loadKg: null, loadUnit: "kg", maxReps: false, isTiebreak: false, captureStyle: null, maxAttempts: 3 },
          ],
        },
      ],
    };
  }

  it("REGRESION de produccion: una marca descartada por descanso no deja que la SIGUIENTE marca legitima cierre el paso viejo", () => {
    reset();
    const estructura = estructuraReal();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 187_019, { cantidad: 28, partMovementId: "cj" }), // cierra bloque 1.
      // Esta marca cae DENTRO del descanso (187_019 a 247_019): se descarta,
      // y el puntero se queda en Crossover.
      marcaje("movement_done", 208_099, { partMovementId: "cr" }),
      // Esta es LEGITIMA -llega bien despues del descanso- pero apunta a
      // Handstand Push-up, NO a Crossover, que es lo que sigue apuntando el
      // puntero. Sin el fix, esto cerraba Crossover con las 15 completas.
      marcaje("movement_done", 397_774, { partMovementId: "hs" }),
    ];
    const r = reduceWodEvents("c1", eventos, estructura, 397_774);

    expect(r.anomalies.some((a) => a.code === "marca_durante_descanso")).toBe(true);
    // La marca de HSPU se rechaza -no corrompe a Crossover- y queda auditable.
    expect(r.anomalies.some((a) => a.code === "marca_de_otro_movimiento")).toBe(true);
    // Crossover NO quedo cerrado con las 15 que nunca se marcaron de verdad.
    expect(r.currentStepIndex).toBe(1); // sigue esperando Crossover.
    expect(r.currentStepProgress).toBe(0);
    expect(r.completedReps).toBe(28); // solo lo del bloque 1: nada de b2 todavia.
  });

  it("la marca correcta, con el partMovementId correcto, cierra sin problema", () => {
    reset();
    const estructura = estructuraReal();
    const eventos = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 187_019, { cantidad: 28, partMovementId: "cj" }),
      marcaje("movement_done", 260_000, { partMovementId: "cr" }), // legitima, DESPUES del descanso, apunta bien.
    ];
    const r = reduceWodEvents("c1", eventos, estructura, 260_000);
    expect(r.anomalies.some((a) => a.code === "marca_de_otro_movimiento")).toBe(false);
    expect(r.currentStepIndex).toBe(2); // avanzo a HSPU.
    expect(r.completedReps).toBe(43); // 28 + 15 (Crossover completo).
  });
});
