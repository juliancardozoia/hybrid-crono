/**
 * Verificacion y publicacion.
 *
 * Lo que importa probar: que publicar CONGELA el resultado. Si el snapshot
 * siguiera reflejando la tabla `results`, un recalculo posterior cambiaria un
 * podio ya anunciado.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAnon, asUser, expectDenied } from "./harness";
import { asignarJueces, seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();

  await asUser(s.db, s.users.owner, () =>
    s.db.query(
      `insert into results (lane_id, event_id, heat_id, team_id, division_id, status, raw_ms, total_ms, source_event_count)
       values ($1, $2, $3, $4, $5, 'finished', 3400000, 3400000, 12),
              ($6, $2, $3, $7, $5, 'finished', 3300000, 3300000, 12),
              ($8, $2, $3, $9, $5, 'dnf', null, null, 4)`,
      [
        s.laneIds[0], s.eventId, s.heatId, s.teamIds[0], s.divisionId,
        s.laneIds[1], s.teamIds[1],
        s.laneIds[2], s.teamIds[2],
      ],
    ),
  );
});

describe("verify_results", () => {
  it("marca quien verifico y cuando", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      const res = await s.db.query<{ verify_results: number }>(
        "select verify_results($1) as verify_results",
        [s.eventId],
      );
      expect(res.rows[0].verify_results).toBe(3);
    });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from results where event_id = $1 and verified_at is not null",
        [s.eventId],
      );
      expect(res.rows[0].n).toBe(3);
    });
  });

  it("no toca ningun tiempo", async () => {
    await asUser(s.db, s.users.headJudge, () =>
      s.db.query("select verify_results($1)", [s.eventId]),
    );
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ total_ms: number }>(
        "select total_ms from results where lane_id = $1",
        [s.laneIds[0]],
      );
      expect(res.rows[0].total_ms).toBe(3_400_000);
    });
  });

  it("un juez comun no puede verificar", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() => s.db.query("select verify_results($1)", [s.eventId]));
      expect(msg).toContain("juez principal");
    });
  });
});

describe("publish_results", () => {
  it("guarda el ranking completo en el snapshot", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ snapshot: unknown }>(
        "select snapshot from publish_results($1)",
        [s.eventId],
      );
      const filas = res.rows[0].snapshot as Array<Record<string, unknown>>;

      expect(filas).toHaveLength(3);
      // Gana el menor tiempo; el DNF va al fondo.
      expect(filas[0].bib_number).toBe(102);
      expect(filas[0].rank_position).toBe(1);
      expect(filas[2].status).toBe("dnf");
    });
  });

  it("incluye los nombres de los atletas, no solo ids", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ snapshot: unknown }>(
        "select snapshot from publish_results($1)",
        [s.eventId],
      );
      const filas = res.rows[0].snapshot as Array<Record<string, unknown>>;
      expect(String(filas[0].athletes)).toContain("Perez");
      expect(filas[0].division_name).toBe("Individual Masculino RX");
    });
  });

  // El punto entero de que exista un snapshot.
  it("el snapshot NO cambia si despues se recalculan los resultados", async () => {
    let antes: string;

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ snapshot: unknown }>(
        "select snapshot from publish_results($1)",
        [s.eventId],
      );
      antes = JSON.stringify(res.rows[0].snapshot);

      // Alguien corrige un tiempo despues de publicar.
      await s.db.query("update results set total_ms = 1 where lane_id = $1", [s.laneIds[0]]);

      const despues = await s.db.query<{ snapshot: unknown }>(
        "select snapshot from result_publications where event_id = $1",
        [s.eventId],
      );
      expect(JSON.stringify(despues.rows[0].snapshot)).toBe(antes);
    });
  });

  it("republicar deja las dos publicaciones, no pisa la anterior", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select publish_results($1)", [s.eventId]);
      await s.db.query("update results set total_ms = 3000000 where lane_id = $1", [s.laneIds[0]]);
      await s.db.query("select publish_results($1)", [s.eventId]);

      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from result_publications where event_id = $1",
        [s.eventId],
      );
      expect(res.rows[0].n).toBe(2);
    });
  });

  it("puede publicarse una sola division", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ division_id: string }>(
        "select division_id from publish_results($1, $2)",
        [s.eventId, s.divisionId],
      );
      expect(res.rows[0].division_id).toBe(s.divisionId);
    });
  });

  it("el head judge no puede publicar: eso lo decide la organizacion", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      const msg = await expectDenied(() => s.db.query("select publish_results($1)", [s.eventId]));
      expect(msg).toContain("puede publicar");
    });
  });

  it("un anonimo no puede publicar", async () => {
    await asAnon(s.db, async () => {
      await expectDenied(() => s.db.query("select publish_results($1)", [s.eventId]));
    });
  });
});

describe("verification_queue", () => {
  it("lista los carriles con lo que hay que revisar", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ bib_number: number; verified: boolean; event_count: number }>(
        "select bib_number, verified, event_count from verification_queue($1)",
        [s.eventId],
      );
      expect(res.rows).toHaveLength(3);
      expect(res.rows.every((r) => r.verified === false)).toBe(true);
    });
  });

  it("cuenta los marcajes anulados", async () => {
    const marcaje = "11111111-1111-4111-8111-111111111111";
    await asignarJueces(s);
    await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));
    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select ingest_timing_events($1::jsonb)", [
        JSON.stringify([
          {
            id: marcaje,
            laneId: s.laneIds[0],
            seq: 1,
            type: "segment_split",
            elapsedMs: 1000,
            payload: {},
            deviceId: "d",
          },
        ]),
      ]);
    });
    await asUser(s.db, s.users.headJudge, () =>
      s.db.query("select void_timing_event($1, 'carril equivocado')", [marcaje]),
    );

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ voided_count: number }>(
        "select voided_count from verification_queue($1) where lane_id = $2",
        [s.eventId, s.laneIds[0]],
      );
      expect(res.rows[0].voided_count).toBe(1);
    });
  });

  it("marca los heats que largaron sin señal", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "update heats set started_at = now(), start_source = 'device_offline', status = 'running' where id = $1",
        [s.heatId],
      );
      const res = await s.db.query<{ started_offline: boolean }>(
        "select started_offline from verification_queue($1) limit 1",
        [s.eventId],
      );
      expect(res.rows[0].started_offline).toBe(true);
    });
  });

  it("un juez comun no ve la cola de verificacion", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query("select * from verification_queue($1)", [s.eventId]);
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe("politica de privilegios de funciones", () => {
  // Regresion: verify_results, publish_results y verification_queue se crearon
  // despues de la migracion de cierre y nacieron con EXECUTE para PUBLIC. Como
  // Supabase publica el schema public como API REST, eran endpoints abiertos.
  const internas = [
    ["verify_results", "select verify_results($1)"],
    ["publish_results", "select publish_results($1)"],
    ["verification_queue", "select * from verification_queue($1)"],
    ["apply_function_lockdown", "select apply_function_lockdown()"],
  ] as const;

  for (const [nombre, sql] of internas) {
    it(`un anonimo no puede ejecutar ${nombre}`, async () => {
      await asAnon(s.db, async () => {
        const msg = await expectDenied(() =>
          sql.includes("$1") ? s.db.query(sql, [s.eventId]) : s.db.query(sql),
        );
        expect(msg.toLowerCase()).toContain("permission denied");
      });
    });
  }

  it("un usuario logueado tampoco puede reaplicar la politica a mano", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() => s.db.query("select apply_function_lockdown()"));
      expect(msg.toLowerCase()).toContain("permission denied");
    });
  });

  it("pero las funciones public_* siguen abiertas al publico", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query("select * from public_event_info('copa-test')");
      expect(Array.isArray(res.rows)).toBe(true);
    });
  });
});
