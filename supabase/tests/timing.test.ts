/**
 * El log de marcajes.
 *
 * Se verifican las tres garantias que sostienen la confianza en un resultado:
 * que reenviar no duplica, que un juez no puede firmar por otro, y que un
 * tiempo registrado no se puede alterar.
 */

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { asAnon, asUser, expectDenied } from "./harness";
import { asignarJueces, marcaje, seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let lane: string;

beforeEach(async () => {
  s = await seedScenario();
  lane = s.laneIds[0];
  // Los jueces toman sus carriles ANTES de la largada: la base no larga un heat
  // con carriles sin juez.
  await asignarJueces(s);
  await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));
});

function lote(...eventos: ReturnType<typeof marcaje>[]) {
  return JSON.stringify(eventos);
}

describe("ingest_timing_events - idempotencia", () => {
  it("acepta un lote nuevo", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [
          lote(
            marcaje({ id: randomUUID(), laneId: lane, seq: 1, type: "lane_start" }),
            marcaje({ id: randomUUID(), laneId: lane, seq: 2, type: "segment_split", elapsedMs: 125_000 }),
          ),
        ],
      );
      expect(res.rows.map((r) => r.accepted)).toEqual([true, true]);
    });
  });

  // El caso real: al juez se le corta la red, reintenta, y el lote llega dos
  // veces. Si esto duplicara, el atleta tendria parciales fantasma.
  it("reenviar el mismo lote no duplica nada", async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const batch = lote(
      marcaje({ id: ids[0], laneId: lane, seq: 1, type: "lane_start" }),
      marcaje({ id: ids[1], laneId: lane, seq: 2, type: "segment_split", elapsedMs: 125_000 }),
      marcaje({ id: ids[2], laneId: lane, seq: 3, type: "segment_split", elapsedMs: 260_000 }),
    );

    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select ingest_timing_events($1::jsonb)", [batch]);
      const segunda = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [batch],
      );
      const tercera = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [batch],
      );

      // La segunda y la tercera reportan que no aceptaron nada nuevo.
      expect(segunda.rows.every((r) => r.accepted === false)).toBe(true);
      expect(tercera.rows.every((r) => r.accepted === false)).toBe(true);

      const total = await s.db.query<{ n: number }>(
        "select count(*)::int as n from timing_events where lane_id = $1",
        [lane],
      );
      expect(total.rows[0].n).toBe(3);
    });
  });

  it("un lote parcialmente nuevo inserta solo lo que falta", async () => {
    const viejo = randomUUID();
    const nuevo = randomUUID();

    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select ingest_timing_events($1::jsonb)", [
        lote(marcaje({ id: viejo, laneId: lane, seq: 1, type: "lane_start" })),
      ]);

      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [
          lote(
            marcaje({ id: viejo, laneId: lane, seq: 1, type: "lane_start" }),
            marcaje({ id: nuevo, laneId: lane, seq: 2, type: "segment_split", elapsedMs: 90_000 }),
          ),
        ],
      );
      expect(res.rows.map((r) => r.accepted)).toEqual([false, true]);
    });
  });
});

describe("ingest_timing_events - autoria", () => {
  it("recorded_by sale de la sesion, no del payload del cliente", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select ingest_timing_events($1::jsonb)", [
        JSON.stringify([
          {
            ...marcaje({ id: randomUUID(), laneId: lane, seq: 1, type: "lane_start" }),
            // Un cliente malicioso intenta firmar como el head judge.
            recordedBy: s.users.headJudge,
          },
        ]),
      ]);

      const res = await s.db.query<{ recorded_by: string }>(
        "select recorded_by from timing_events where lane_id = $1",
        [lane],
      );
      expect(res.rows[0].recorded_by).toBe(s.users.judgeA);
    });
  });

  it("otro juez no puede marcar en un carril ajeno", async () => {
    await asUser(s.db, s.users.judgeB, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select ingest_timing_events($1::jsonb)", [
          lote(marcaje({ id: randomUUID(), laneId: lane, seq: 1, type: "segment_split" })),
        ]),
      );
      expect(msg).toContain("asignado a otro juez");
    });
  });

  it("el head judge SI puede, para corregir en caliente", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [lote(marcaje({ id: randomUUID(), laneId: lane, seq: 9, type: "segment_split", elapsedMs: 1000 }))],
      );
      expect(res.rows[0].accepted).toBe(true);
    });
  });

  it("alguien ajeno al evento no puede marcar nada", async () => {
    await asUser(s.db, s.users.forastero, async () => {
      await expectDenied(() =>
        s.db.query("select ingest_timing_events($1::jsonb)", [
          lote(marcaje({ id: randomUUID(), laneId: lane, seq: 1, type: "segment_split" })),
        ]),
      );
    });
  });
});

describe("el log es append-only", () => {
  beforeEach(async () => {
    await asUser(s.db, s.users.judgeA, () =>
      s.db.query("select ingest_timing_events($1::jsonb)", [
        lote(marcaje({ id: randomUUID(), laneId: lane, seq: 1, type: "segment_split", elapsedMs: 300_000 })),
      ]),
    );
  });

  // Esta es la garantia central del producto y no depende de la app: Postgres
  // simplemente no le otorga UPDATE al rol authenticated.
  it("un juez no puede modificar un tiempo ya registrado", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("update timing_events set elapsed_ms = 1 where lane_id = $1", [lane]),
      );
      expect(msg.toLowerCase()).toContain("permission denied");
    });
  });

  it("un juez no puede borrar un marcaje", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("delete from timing_events where lane_id = $1", [lane]),
      );
      expect(msg.toLowerCase()).toContain("permission denied");
    });
  });

  it("ni el organizador puede editarlo a mano", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("update timing_events set elapsed_ms = 1 where lane_id = $1", [lane]),
      );
      expect(msg.toLowerCase()).toContain("permission denied");
    });
  });
});

describe("void_timing_event", () => {
  let marcajeId: string;

  beforeEach(async () => {
    marcajeId = randomUUID();
    await asUser(s.db, s.users.judgeA, () =>
      s.db.query("select ingest_timing_events($1::jsonb)", [
        lote(marcaje({ id: marcajeId, laneId: lane, seq: 1, type: "segment_split", elapsedMs: 300_000 })),
      ]),
    );
  });

  it("el head judge anula un marcaje con motivo", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      const res = await s.db.query<{ voided: boolean; void_reason: string }>(
        "select voided, void_reason from void_timing_event($1, $2)",
        [marcajeId, "Marcaje del carril equivocado"],
      );
      expect(res.rows[0]).toMatchObject({
        voided: true,
        void_reason: "Marcaje del carril equivocado",
      });
    });
  });

  it("anular no borra: el marcaje sigue en el log", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      await s.db.query("select void_timing_event($1, 'error')", [marcajeId]);
      const res = await s.db.query<{ elapsed_ms: number }>(
        "select elapsed_ms from timing_events where id = $1",
        [marcajeId],
      );
      expect(res.rows[0].elapsed_ms).toBe(300_000);
    });
  });

  it("el juez que lo registro no puede anularlo", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select void_timing_event($1, 'me equivoque')", [marcajeId]),
      );
      expect(msg).toContain("juez principal");
    });
  });

  it("anular exige un motivo", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select void_timing_event($1, '   ')", [marcajeId]),
      );
      expect(msg).toContain("motivo");
    });
  });
});

describe("public_leaderboard", () => {
  beforeEach(async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        `insert into results (lane_id, event_id, heat_id, team_id, division_id, status, raw_ms, total_ms)
         values ($1, $2, $3, $4, $5, 'finished', 3400000, 3400000),
                ($6, $2, $3, $7, $5, 'finished', 3300000, 3300000)`,
        [
          s.laneIds[0],
          s.eventId,
          s.heatId,
          s.teamIds[0],
          s.divisionId,
          s.laneIds[1],
          s.teamIds[1],
        ],
      ),
    );
  });

  it("un anonimo puede ver el leaderboard de un evento en vivo", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ bib_number: number; rank_position: number }>(
        "select bib_number, rank_position from public_leaderboard($1) order by rank_position",
        ["copa-test"],
      );
      expect(res.rows).toHaveLength(2);
      // Gana el menor tiempo.
      expect(res.rows[0].bib_number).toBe(102);
    });
  });

  it("marca los resultados como no oficiales mientras el evento no este publicado", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ official: boolean }>(
        "select official from public_leaderboard($1) limit 1",
        ["copa-test"],
      );
      expect(res.rows[0].official).toBe(false);
    });
  });

  it("un evento en borrador no expone nada", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update events set status = 'draft' where id = $1", [s.eventId]),
    );
    await asAnon(s.db, async () => {
      const res = await s.db.query("select * from public_leaderboard($1)", ["copa-test"]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("el anonimo no llega a las tablas por debajo", async () => {
    await asAnon(s.db, async () => {
      await expectDenied(() => s.db.query("select email from athletes"));
    });
  });
});

describe("superficie de RPC para anonimos", () => {
  // En Postgres las funciones nacen con EXECUTE otorgado a PUBLIC, y anon lo
  // hereda. Revocar solo `from anon` no quita nada: hay que revocar `from
  // public`. Supabase expone toda funcion del schema public como endpoint REST,
  // asi que sin esto cualquiera puede POSTear a /rest/v1/rpc/claim_lane.
  const prohibidas = [
    ["claim_lane", "select claim_lane('00000000-0000-0000-0000-000000000000')"],
    ["start_heat", "select start_heat('00000000-0000-0000-0000-000000000000')"],
    ["import_teams", "select import_teams('00000000-0000-0000-0000-000000000000', '[]'::jsonb)"],
    ["ingest_timing_events", "select ingest_timing_events('[]'::jsonb)"],
    ["void_timing_event", "select void_timing_event('00000000-0000-0000-0000-000000000000', 'x')"],
    ["user_org_role", "select user_org_role('00000000-0000-0000-0000-000000000000')"],
    ["add_creator_as_owner", "select add_creator_as_owner()"],
  ] as const;

  for (const [nombre, sql] of prohibidas) {
    it(`un anonimo no puede ejecutar ${nombre}`, async () => {
      await asAnon(s.db, async () => {
        const msg = await expectDenied(() => s.db.query(sql));
        expect(msg.toLowerCase()).toContain("permission denied");
      });
    });
  }

  it("pero el leaderboard publico si", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query("select * from public_leaderboard('copa-test')");
      expect(Array.isArray(res.rows)).toBe(true);
    });
  });
});

describe("public_event_info", () => {
  it("expone los datos de cabecera de un evento en vivo", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ name: string; official: boolean }>(
        "select name, official from public_event_info('copa-test')",
      );
      expect(res.rows[0]).toMatchObject({ name: "Copa Test", official: false });
    });
  });

  it("no expone un evento en borrador", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update events set status = 'draft' where id = $1", [s.eventId]),
    );
    await asAnon(s.db, async () => {
      const res = await s.db.query("select * from public_event_info('copa-test')");
      expect(res.rows).toHaveLength(0);
    });
  });

  it("marca oficial cuando el evento esta publicado", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update events set status = 'published' where id = $1", [s.eventId]),
    );
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ official: boolean }>(
        "select official from public_event_info('copa-test')",
      );
      expect(res.rows[0].official).toBe(true);
    });
  });

  it("no filtra el id de la organizacion ni ids internos", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query("select * from public_event_info('copa-test')");
      const columnas = Object.keys(res.rows[0] as object);
      expect(columnas).toEqual(["name", "venue", "event_date", "status", "official"]);
    });
  });
});
