import { describe, expect, it } from "vitest";
import { calcularScoresDeWod, carrilesTerminados, partesQueCorreLaCategoria } from "./recompute";
import type {
  FilaDeBloque,
  FilaDeMovimiento,
  FilaDeParte,
} from "@/shared/timing/wodStructure";
import type { TimingEvent, TimingEventType } from "@/shared/timing/types";

let seq = 0;

function marcaje(
  type: TimingEventType,
  elapsedMs: number,
  payload: Record<string, unknown> = {},
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
  };
}

/** Una parte "For Time con cap" de un solo movimiento, una sola ronda. */
function parte(id: string, overrides: Partial<FilaDeParte> = {}): FilaDeParte {
  return {
    id,
    label: "",
    order_index: 0,
    time_scheme: "cap",
    score_unit: "tiempo",
    time_cap_ms: 60_000,
    window_ms: null,
    interval_ms: null,
    ...overrides,
  };
}

function bloque(partId: string, id = `b-${partId}`): FilaDeBloque {
  return {
    id,
    part_id: partId,
    order_index: 0,
    kind: "trabajo",
    repeticiones: 1,
    duracion_ms: null,
    descanso_ms: null,
  };
}

function movimiento(
  partId: string,
  blockId: string,
  overrides: Partial<FilaDeMovimiento> = {},
): FilaDeMovimiento {
  return {
    id: `m-${partId}`,
    block_id: blockId,
    part_id: partId,
    order_index: 0,
    movement_id: null,
    custom_name: "Thruster",
    unit: "reps",
    target_per_round: [5],
    load_kg: 43,
    load_unit: "kg",
    max_reps: false,
    es_tiebreak: false,
    capture_style: null,
    ...overrides,
  };
}

describe("partesQueCorreLaCategoria", () => {
  it("una categoria que no esta en part_divisions no corre ninguna parte", () => {
    const partes = [parte("p1"), parte("p2")];
    const { suyas, capPorParte } = partesQueCorreLaCategoria(partes, []);
    expect(suyas).toEqual([]);
    expect(capPorParte.size).toBe(0);
  });

  it("solo trae las partes asignadas a esta categoria, no todas las del workout", () => {
    const partes = [parte("p1"), parte("p2")];
    const { suyas } = partesQueCorreLaCategoria(partes, [
      { part_id: "p1", time_cap_ms: null },
    ]);
    expect(suyas.map((p) => p.id)).toEqual(["p1"]);
  });

  it("el cap de la categoria viaja en el mapa, incluso si es distinto del de la parte", () => {
    const partes = [parte("p1", { time_cap_ms: 600_000 })];
    const { capPorParte } = partesQueCorreLaCategoria(partes, [
      { part_id: "p1", time_cap_ms: 300_000 },
    ]);
    expect(capPorParte.get("p1")).toBe(300_000);
  });

  it("sin override de cap, la entrada queda en null: la parte manda", () => {
    const partes = [parte("p1")];
    const { capPorParte } = partesQueCorreLaCategoria(partes, [
      { part_id: "p1", time_cap_ms: null },
    ]);
    expect(capPorParte.get("p1")).toBeNull();
  });
});

describe("calcularScoresDeWod", () => {
  it("un movimiento cerrado antes del cap termina en valido con el tiempo de cierre", () => {
    const p = parte("p1");
    const b = bloque("p1");
    const m = movimiento("p1", b.id);
    const { suyas, capPorParte } = partesQueCorreLaCategoria([p], [
      { part_id: "p1", time_cap_ms: null },
    ]);

    const eventos: TimingEvent[] = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 40_000, { partId: "p1", partMovementId: m.id }),
    ];

    const [score] = calcularScoresDeWod({
      suyas,
      capPorParte,
      bloques: [b],
      movimientos: [m],
      nombres: new Map(),
      specs: new Map(),
      nowElapsedMs: undefined,
      eventos,
      laneId: "c1",
      teamId: "t1",
      eventId: "ev1",
      divisionId: "d1",
    });

    expect(score.status).toBe("valido");
    expect(score.value_num).toBe(40_000);
    expect(score.value_cap).toBeNull();
  });

  it("sin marcar el movimiento y con el cap de la parte vencido, el score queda capeado", () => {
    const p = parte("p1", { time_cap_ms: 60_000 });
    const b = bloque("p1");
    const m = movimiento("p1", b.id);
    const { suyas, capPorParte } = partesQueCorreLaCategoria([p], [
      { part_id: "p1", time_cap_ms: null },
    ]);

    const eventos: TimingEvent[] = [marcaje("lane_start", 0)];

    const [score] = calcularScoresDeWod({
      suyas,
      capPorParte,
      bloques: [b],
      movimientos: [m],
      nombres: new Map(),
      specs: new Map(),
      // La app quedo en segundo plano: nadie emitio el evento de cap, pero el
      // heat ya lleva mas de un minuto corriendo.
      nowElapsedMs: 65_000,
      eventos,
      laneId: "c1",
      teamId: "t1",
      eventId: "ev1",
      divisionId: "d1",
    });

    expect(score.status).toBe("capeado");
    expect(score.value_cap).toBe(0);
    expect(score.value_num).toBeNull();
  });

  it("el cap de la categoria manda sobre el de la parte, para bien o para mal", () => {
    // La parte da 10 minutos, pero esta categoria (mas avanzada) capea a los 2.
    const p = parte("p1", { time_cap_ms: 600_000 });
    const b = bloque("p1");
    const m = movimiento("p1", b.id);
    const { suyas, capPorParte } = partesQueCorreLaCategoria([p], [
      { part_id: "p1", time_cap_ms: 120_000 },
    ]);

    const eventos: TimingEvent[] = [marcaje("lane_start", 0)];

    const [score] = calcularScoresDeWod({
      suyas,
      capPorParte,
      bloques: [b],
      movimientos: [m],
      nombres: new Map(),
      specs: new Map(),
      // Paso el cap de la categoria (2 min) pero no el de la parte (10 min).
      nowElapsedMs: 150_000,
      eventos,
      laneId: "c1",
      teamId: "t1",
      eventId: "ev1",
      divisionId: "d1",
    });

    expect(score.status).toBe("capeado");
  });

  it("una categoria que no corre esta parte no produce ningun score para ella", () => {
    const partes = [parte("p1"), parte("p2")];
    const { suyas, capPorParte } = partesQueCorreLaCategoria(partes, [
      { part_id: "p1", time_cap_ms: null },
    ]);

    const b1 = bloque("p1");
    const m1 = movimiento("p1", b1.id);
    const b2 = bloque("p2");
    const m2 = movimiento("p2", b2.id);

    const eventos: TimingEvent[] = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 40_000, { partId: "p1", partMovementId: m1.id }),
      // Esta categoria no corre p2: si el filtro fallara, este marcaje se
      // colaria igual y produciria un segundo score inventado.
      marcaje("movement_done", 50_000, { partId: "p2", partMovementId: m2.id }),
    ];

    const scores = calcularScoresDeWod({
      suyas,
      capPorParte,
      bloques: [b1, b2],
      movimientos: [m1, m2],
      nombres: new Map(),
      specs: new Map(),
      nowElapsedMs: undefined,
      eventos,
      laneId: "c1",
      teamId: "t1",
      eventId: "ev1",
      divisionId: "d1",
    });

    expect(scores).toHaveLength(1);
    expect(scores[0].part_id).toBe("p1");
  });

  it("dos partes del mismo workout se puntuan por separado, cada una con sus propios marcajes", () => {
    // Cap generoso: lo que se prueba aca es el aislamiento entre partes, no el
    // cap — con el default de 60_000 el cierre de pB a los 90_000 quedaria
    // capeado (correctamente) y el test dejaria de probar lo que dice probar.
    const pA = parte("pA", { time_scheme: "cap", score_unit: "tiempo", time_cap_ms: 120_000 });
    const pB = parte("pB", { time_scheme: "cap", score_unit: "tiempo", time_cap_ms: 120_000 });
    const { suyas, capPorParte } = partesQueCorreLaCategoria([pA, pB], [
      { part_id: "pA", time_cap_ms: null },
      { part_id: "pB", time_cap_ms: null },
    ]);

    const bA = bloque("pA");
    const mA = movimiento("pA", bA.id);
    const bB = bloque("pB");
    const mB = movimiento("pB", bB.id);

    const eventos: TimingEvent[] = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 30_000, { partId: "pA", partMovementId: mA.id }),
      marcaje("movement_done", 90_000, { partId: "pB", partMovementId: mB.id }),
    ];

    const scores = calcularScoresDeWod({
      suyas,
      capPorParte,
      bloques: [bA, bB],
      movimientos: [mA, mB],
      nombres: new Map(),
      specs: new Map(),
      nowElapsedMs: undefined,
      eventos,
      laneId: "c1",
      teamId: "t1",
      eventId: "ev1",
      divisionId: "d1",
    });

    expect(scores).toHaveLength(2);
    const porParte = new Map(scores.map((s) => [s.part_id, s]));
    expect(porParte.get("pA")?.value_num).toBe(30_000);
    expect(porParte.get("pB")?.value_num).toBe(90_000);
  });

  it("pasar el spec de la categoria no rompe el calculo del score", () => {
    // No hay forma de observar el peso desde el score (solo lo mira el
    // reductor para armar el plan), pero esta prueba deja constancia de que
    // pasar `specs` no rompe nada: es la misma spec que usa el juez para
    // pintar el peso de Rx contra Scaled.
    const p = parte("p1");
    const b = bloque("p1");
    const m = movimiento("p1", b.id, { load_kg: 43, load_unit: "kg" });
    const { suyas, capPorParte } = partesQueCorreLaCategoria([p], [
      { part_id: "p1", time_cap_ms: null },
    ]);

    const eventos: TimingEvent[] = [
      marcaje("lane_start", 0),
      marcaje("movement_done", 20_000, { partId: "p1", partMovementId: m.id }),
    ];

    const scores = calcularScoresDeWod({
      suyas,
      capPorParte,
      bloques: [b],
      movimientos: [m],
      nombres: new Map(),
      specs: new Map([[m.id, { target_per_round: null, load_kg: 29, load_unit: "kg" }]]),
      nowElapsedMs: undefined,
      eventos,
      laneId: "c1",
      teamId: "t1",
      eventId: "ev1",
      divisionId: "d1",
    });

    expect(scores[0].status).toBe("valido");
    expect(scores[0].value_num).toBe(20_000);
  });
});

describe("carrilesTerminados", () => {
  it("un carril de circuito termina segun 'results', no segun workout_scores", () => {
    const terminados = carrilesTerminados(
      [{ laneId: "c1" }],
      new Map([["c1", "finished"]]),
      new Map(),
    );
    expect(terminados.has("c1")).toBe(true);
  });

  it("un carril de circuito 'running' no es terminal", () => {
    const terminados = carrilesTerminados(
      [{ laneId: "c1" }],
      new Map([["c1", "running"]]),
      new Map(),
    );
    expect(terminados.has("c1")).toBe(false);
  });

  it("un carril de WOD termina cuando TODAS sus partes en vivo son terminales", () => {
    // Es el hueco real: antes solo se miraba `results`, asi que un heat 100%
    // CrossFit -sin ninguna fila en results- nunca se marcaba terminado.
    const terminados = carrilesTerminados(
      [{ laneId: "w1" }],
      new Map(),
      new Map([["w1", ["valido", "capeado"]]]),
    );
    expect(terminados.has("w1")).toBe(true);
  });

  it("un carril de WOD con una sola parte todavia pendiente NO es terminal", () => {
    const terminados = carrilesTerminados(
      [{ laneId: "w1" }],
      new Map(),
      new Map([["w1", ["valido", "en_curso"]]]),
    );
    expect(terminados.has("w1")).toBe(false);
  });

  it("un carril sin resultado de ningun tipo no es terminal", () => {
    const terminados = carrilesTerminados([{ laneId: "w1" }], new Map(), new Map());
    expect(terminados.has("w1")).toBe(false);
  });

  it("evalua cada carril de forma independiente", () => {
    const terminados = carrilesTerminados(
      [{ laneId: "c1" }, { laneId: "c2" }, { laneId: "w1" }],
      new Map([
        ["c1", "finished"],
        ["c2", "running"],
      ]),
      new Map([["w1", ["dnf"]]]),
    );
    expect([...terminados].sort()).toEqual(["c1", "w1"]);
  });
});
