/**
 * Deshacer la largada de un heat aunque los jueces ya hayan entrado o marcado.
 *
 * Tres garantias, y cada una tiene su bloque:
 *   1. `cancel_heat_start` solo se bloquea por lo que seria PERDER un tiempo.
 *   2. `start_generation` separa la carrera vieja de la nueva, incluso cuando un
 *      tap atrasado llega despues de que el heat volvio a largar.
 *   3. `deshacer_largada_completa` anula todo con un motivo, sin borrar nada.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

const E1 = "33333333-3333-4333-8333-333333333331";
const E2 = "33333333-3333-4333-8333-333333333332";
const E3 = "33333333-3333-4333-8333-333333333333";

interface Marcaje {
  id: string;
  laneId: string;
  seq: number;
  type: string;
  elapsedMs?: number;
  startGeneration?: number;
  supersedesId?: string;
}

async function ingerir(quien: string, marcajes: Marcaje[]) {
  await asUser(s.db, quien, () =>
    s.db.query("select ingest_timing_events($1::jsonb)", [
      JSON.stringify(marcajes.map((m) => ({ payload: {}, deviceId: "d", elapsedMs: 0, ...m }))),
    ]),
  );
}

/** Deja al heat largado, con jueces en todos los carriles. */
async function largar() {
  await asUser(s.db, s.users.judgeA, async () => {
    for (const lane of s.laneIds) await s.db.query("select claim_lane($1)", [lane]);
  });
  await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));
}

async function generacionDelHeat(): Promise<number> {
  const r = await asAdmin(s.db, () =>
    s.db.query<{ start_generation: number }>("select start_generation from heats where id = $1", [
      s.heatId,
    ]),
  );
  return r.rows[0].start_generation;
}

async function forzarResultado(laneId: string, status: string) {
  await asAdmin(s.db, () =>
    s.db.query(
      `insert into results (lane_id, event_id, heat_id, team_id, division_id, status, total_ms)
       select l.id, l.event_id, l.heat_id, l.team_id, t.division_id, $2::lane_status, null
       from lanes l join teams t on t.id = l.team_id
       where l.id = $1`,
      [laneId, status],
    ),
  );
}

describe("cancel_heat_start ignora lo que no es un tiempo", () => {
  // El celular escribe un lane_start apenas ancla el reloj, sin que el juez
  // toque nada, y los jueces abren el cronometro ANTES de la largada.
  it("deshace aunque el juez ya haya entrado (solo hay un lane_start)", async () => {
    await largar();
    await ingerir(s.users.judgeA, [{ id: E1, laneId: s.laneIds[0], seq: 1, type: "lane_start" }]);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ status: string }>(
        "select status from cancel_heat_start($1)",
        [s.heatId],
      );
      expect(res.rows[0].status).toBe("scheduled");
    });
  });

  it("un tap real sigue bloqueando, y el mensaje no cuenta el lane_start", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E1, laneId: s.laneIds[0], seq: 1, type: "lane_start" },
      { id: E2, laneId: s.laneIds[0], seq: 2, type: "segment_split", elapsedMs: 5000 },
    ]);

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() => s.db.query("select cancel_heat_start($1)", [s.heatId]));
      expect(msg).toContain("1 marcaje(s)");
    });
  });

  it("un tap que el juez ya deshizo con `undo` no bloquea", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E1, laneId: s.laneIds[0], seq: 1, type: "lane_start" },
      { id: E2, laneId: s.laneIds[0], seq: 2, type: "segment_split", elapsedMs: 5000 },
      { id: E3, laneId: s.laneIds[0], seq: 3, type: "undo", elapsedMs: 6000, supersedesId: E2 },
    ]);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ status: string }>(
        "select status from cancel_heat_start($1)",
        [s.heatId],
      );
      expect(res.rows[0].status).toBe("scheduled");
    });
  });

  it("un tap anulado por la organizacion tampoco bloquea", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E2, laneId: s.laneIds[0], seq: 1, type: "segment_split", elapsedMs: 5000 },
    ]);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select void_timing_event($1, 'tap por error')", [E2]);
      const res = await s.db.query<{ status: string }>(
        "select status from cancel_heat_start($1)",
        [s.heatId],
      );
      expect(res.rows[0].status).toBe("scheduled");
    });
  });
});

describe("start_generation", () => {
  it("arranca en 0 y sube cada vez que se deshace una largada", async () => {
    expect(await generacionDelHeat()).toBe(0);

    await largar();
    await asUser(s.db, s.users.owner, () => s.db.query("select cancel_heat_start($1)", [s.heatId]));
    expect(await generacionDelHeat()).toBe(1);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select start_heat($1)", [s.heatId]);
      await s.db.query("select cancel_heat_start($1)", [s.heatId]);
    });
    expect(await generacionDelHeat()).toBe(2);
  });

  // EL ESCENARIO QUE JUSTIFICA TODO: un tap que quedo atrapado en un celular sin
  // señal llega cuando el MISMO heat ya volvio a largar. El heat conserva su id
  // y sus carriles, asi que sin la generacion seria indistinguible de un tap
  // legitimo de la carrera nueva.
  it("un tap atrasado de la largada anterior se guarda pero no cuenta", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E1, laneId: s.laneIds[0], seq: 1, type: "lane_start", startGeneration: 0 },
    ]);
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select cancel_heat_start($1)", [s.heatId]);
      await s.db.query("select start_heat($1)", [s.heatId]);
    });

    await ingerir(s.users.judgeA, [
      { id: E2, laneId: s.laneIds[0], seq: 2, type: "segment_split", elapsedMs: 45000, startGeneration: 0 },
      { id: E3, laneId: s.laneIds[0], seq: 3, type: "segment_split", elapsedMs: 9000, startGeneration: 1 },
    ]);

    // Nada se pierde: los tres estan en el log, cada uno con su generacion.
    const filas = await asAdmin(s.db, () =>
      s.db.query<{ start_generation: number }>(
        "select start_generation from timing_events order by seq",
      ),
    );
    expect(filas.rows.map((f) => f.start_generation)).toEqual([0, 0, 1]);

    await asUser(s.db, s.users.owner, async () => {
      // La cola de verificacion cuenta solo la carrera vigente.
      const cola = await s.db.query<{ lane_id: string; event_count: number }>(
        "select lane_id, event_count from verification_queue($1)",
        [s.eventId],
      );
      expect(cola.rows.find((r) => r.lane_id === s.laneIds[0])?.event_count).toBe(1);

      // El juez solo baja el log de la carrera vigente.
      const remotos = await s.db.query<{ id: string }>("select id from judge_lane_events($1)", [
        s.laneIds[0],
      ]);
      expect(remotos.rows.map((r) => r.id)).toEqual([E3]);

      // Y el guard de deshacer solo ve el UNICO tap real vigente.
      const msg = await expectDenied(() => s.db.query("select cancel_heat_start($1)", [s.heatId]));
      expect(msg).toContain("1 marcaje(s)");
    });
  });

  it("sin startGeneration se asume la vigente (app vieja o panel)", async () => {
    await largar();
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select cancel_heat_start($1)", [s.heatId]);
      await s.db.query("select start_heat($1)", [s.heatId]);
    });
    await ingerir(s.users.judgeA, [
      { id: E1, laneId: s.laneIds[0], seq: 1, type: "segment_split", elapsedMs: 1000 },
    ]);

    const fila = await asAdmin(s.db, () =>
      s.db.query<{ start_generation: number }>("select start_generation from timing_events"),
    );
    expect(fila.rows[0].start_generation).toBe(1);
  });

  it("una generacion futura se acota a la vigente", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E1, laneId: s.laneIds[0], seq: 1, type: "segment_split", elapsedMs: 1000, startGeneration: 99 },
    ]);

    const fila = await asAdmin(s.db, () =>
      s.db.query<{ start_generation: number }>("select start_generation from timing_events"),
    );
    expect(fila.rows[0].start_generation).toBe(0);
  });
});

describe("deshacer_largada_completa", () => {
  it("anula los marcajes de todos los carriles y deja el heat sin largar", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E1, laneId: s.laneIds[0], seq: 1, type: "lane_start" },
      { id: E2, laneId: s.laneIds[0], seq: 2, type: "segment_split", elapsedMs: 5000 },
      { id: E3, laneId: s.laneIds[1], seq: 1, type: "segment_split", elapsedMs: 6000 },
    ]);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select deshacer_largada_completa($1, 'largada por error') as n",
        [s.heatId],
      );
      // Cuenta los dos taps reales, no el lane_start.
      expect(res.rows[0].n).toBe(2);

      const heat = await s.db.query<{ status: string; started_at: string | null }>(
        "select status, started_at from heats where id = $1",
        [s.heatId],
      );
      expect(heat.rows[0]).toMatchObject({ status: "scheduled", started_at: null });
    });

    // Nada se borro: los tres siguen en el log, anulados, con motivo y autor.
    const log = await asAdmin(s.db, () =>
      s.db.query<{ voided: boolean; void_reason: string | null; voided_by: string | null }>(
        "select voided, void_reason, voided_by from timing_events",
      ),
    );
    expect(log.rows).toHaveLength(3);
    expect(log.rows.every((r) => r.voided)).toBe(true);
    expect(log.rows.every((r) => r.void_reason?.includes("largada por error"))).toBe(true);
    expect(log.rows.every((r) => r.voided_by === s.users.owner)).toBe(true);
  });

  it("el heat se puede volver a largar y arranca limpio", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E2, laneId: s.laneIds[0], seq: 1, type: "segment_split", elapsedMs: 5000 },
    ]);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select deshacer_largada_completa($1, 'error de la organizacion')", [
        s.heatId,
      ]);
      const res = await s.db.query<{ status: string }>("select status from start_heat($1)", [
        s.heatId,
      ]);
      expect(res.rows[0].status).toBe("running");

      // El guard ya no ve nada de la largada anterior.
      const otra = await s.db.query<{ status: string }>(
        "select status from cancel_heat_start($1)",
        [s.heatId],
      );
      expect(otra.rows[0].status).toBe("scheduled");
    });
  });

  it("exige motivo", async () => {
    await largar();
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select deshacer_largada_completa($1, '  ')", [s.heatId]),
      );
      expect(msg).toContain("motivo");
    });
  });

  it("un juez comun no puede", async () => {
    await largar();
    await asUser(s.db, s.users.judgeB, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select deshacer_largada_completa($1, 'quiero probar')", [s.heatId]),
      );
      expect(msg).toContain("permiso");
    });
  });

  it("no hay nada que deshacer si el heat no largo", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select deshacer_largada_completa($1, 'sin largar')", [s.heatId]),
      );
      expect(msg).toContain("no está largado");
    });
  });

  it("NO deshace si un atleta ya termino: ese tiempo es real", async () => {
    await largar();
    await forzarResultado(s.laneIds[0], "finished");

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select deshacer_largada_completa($1, 'ya termino')", [s.heatId]),
      );
      expect(msg).toContain("terminaron");
    });
  });

  it("es todo o nada: si falla, no queda ningun marcaje anulado", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E2, laneId: s.laneIds[0], seq: 1, type: "segment_split", elapsedMs: 5000 },
    ]);
    // Otro carril con DNF: hace fallar la funcion DESPUES de haberse leido todo.
    await forzarResultado(s.laneIds[1], "dnf");

    await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select deshacer_largada_completa($1, 'intento')", [s.heatId])),
    );

    const log = await asAdmin(s.db, () =>
      s.db.query<{ voided: boolean }>("select voided from timing_events"),
    );
    expect(log.rows.every((r) => !r.voided)).toBe(true);
  });
});

// El aviso de Control dice CUANTOS marcajes se anulan: ese numero tiene que ser
// exactamente el que el guard usa para bloquear, no una aproximacion.
describe("heat_marcajes_activos / event_heat_marcajes", () => {
  async function marcajes(): Promise<number> {
    const r = await asUser(s.db, s.users.owner, () =>
      s.db.query<{ n: number }>("select heat_marcajes_activos($1) as n", [s.heatId]),
    );
    return r.rows[0].n;
  }

  it("no cuenta el lane_start, ni lo anulado, ni lo que un undo reemplazo", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E1, laneId: s.laneIds[0], seq: 1, type: "lane_start" },
      { id: E2, laneId: s.laneIds[0], seq: 2, type: "segment_split", elapsedMs: 5000 },
      { id: E3, laneId: s.laneIds[0], seq: 3, type: "undo", elapsedMs: 6000, supersedesId: E2 },
    ]);
    expect(await marcajes()).toBe(0);

    await ingerir(s.users.judgeA, [
      { id: "44444444-4444-4444-8444-444444444441", laneId: s.laneIds[0], seq: 4, type: "segment_split", elapsedMs: 7000 },
      { id: "44444444-4444-4444-8444-444444444442", laneId: s.laneIds[1], seq: 1, type: "segment_split", elapsedMs: 8000 },
    ]);
    expect(await marcajes()).toBe(2);

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select void_timing_event($1, 'tap por error')", [
        "44444444-4444-4444-8444-444444444441",
      ]),
    );
    expect(await marcajes()).toBe(1);
  });

  it("solo cuenta la largada vigente", async () => {
    await largar();
    await ingerir(s.users.judgeA, [
      { id: E2, laneId: s.laneIds[0], seq: 1, type: "segment_split", elapsedMs: 5000, startGeneration: 0 },
    ]);
    expect(await marcajes()).toBe(1);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select deshacer_largada_completa($1, 'error')", [s.heatId]);
      await s.db.query("select start_heat($1)", [s.heatId]);
    });
    // Un tap atrasado de la largada anterior no cuenta para la nueva.
    await ingerir(s.users.judgeA, [
      { id: E3, laneId: s.laneIds[0], seq: 2, type: "segment_split", elapsedMs: 9000, startGeneration: 0 },
    ]);
    expect(await marcajes()).toBe(0);
  });

  it("lista solo los heats en curso del evento, con su cuenta", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const antes = await s.db.query("select * from event_heat_marcajes($1)", [s.eventId]);
      expect(antes.rows).toHaveLength(0);
    });

    await largar();
    await ingerir(s.users.judgeA, [
      { id: E2, laneId: s.laneIds[0], seq: 1, type: "segment_split", elapsedMs: 5000 },
    ]);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ heat_id: string; marcajes: number }>(
        "select heat_id, marcajes from event_heat_marcajes($1)",
        [s.eventId],
      );
      expect(res.rows).toEqual([{ heat_id: s.heatId, marcajes: 1 }]);
    });
  });

  it("un juez comun no puede consultarlo", async () => {
    await largar();
    await asUser(s.db, s.users.judgeB, async () => {
      const res = await s.db.query("select * from event_heat_marcajes($1)", [s.eventId]);
      expect(res.rows).toHaveLength(0);

      const msg = await expectDenied(() =>
        s.db.query("select heat_marcajes_activos($1)", [s.heatId]),
      );
      expect(msg).toContain("permiso");
    });
  });
});
