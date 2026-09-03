/**
 * Los marcajes de un WOD viajan por el mismo camino que los de un circuito.
 *
 * Es lo que hay que demostrar en esta fase: que contar repeticiones no necesita
 * infraestructura nueva. Misma tabla, mismo RPC, misma idempotencia, mismos
 * privilegios. Solo cambian el `type` y el `payload`.
 */

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, expectDenied } from "./harness";
import { asignarJueces, marcaje, seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let lane: string;

beforeEach(async () => {
  s = await seedScenario();
  lane = s.laneIds[0];
  await asignarJueces(s);
  await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));
});

function lote(...eventos: ReturnType<typeof marcaje>[]) {
  return JSON.stringify(eventos);
}

describe("ingesta de marcajes de WOD", () => {
  it("el juez puede registrar repeticiones", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [
          lote(
            marcaje({ id: randomUUID(), laneId: lane, seq: 1, type: "lane_start" }),
            marcaje({
              id: randomUUID(),
              laneId: lane,
              seq: 2,
              type: "rep",
              elapsedMs: 12_000,
              payload: { partMovementId: "m1", round: 1 },
            }),
          ),
        ],
      );
      expect(res.rows.every((r) => r.accepted)).toBe(true);
    });
  });

  it("acepta los siete tipos nuevos", async () => {
    const tipos = ["rep", "no_rep", "movement_done", "round_done", "lift", "tiebreak", "time_cap"];

    await asUser(s.db, s.users.judgeA, async () => {
      const eventos = tipos.map((type, i) =>
        marcaje({
          id: randomUUID(),
          laneId: lane,
          seq: i + 1,
          type,
          elapsedMs: (i + 1) * 1000,
          payload: { partMovementId: "m1", round: 1, loadKg: 60, valido: true },
        }),
      );
      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [JSON.stringify(eventos)],
      );
      expect(res.rows.filter((r) => r.accepted)).toHaveLength(tipos.length);
    });
  });

  it("reenviar un lote de repeticiones no las duplica", async () => {
    // El caso real: se corta la red a mitad de un AMRAP y el outbox reintenta.
    // Si esto duplicara, el atleta terminaria con el doble de reps.
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const batch = lote(
      ...ids.map((id, i) =>
        marcaje({
          id,
          laneId: lane,
          seq: i + 1,
          type: "rep",
          elapsedMs: (i + 1) * 2000,
          payload: { partMovementId: "m1", round: 1 },
        }),
      ),
    );

    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select ingest_timing_events($1::jsonb)", [batch]);
      await s.db.query("select ingest_timing_events($1::jsonb)", [batch]);
      await s.db.query("select ingest_timing_events($1::jsonb)", [batch]);

      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from timing_events where lane_id = $1 and type = 'rep'",
        [lane],
      );
      expect(res.rows[0].n).toBe(3);
    });
  });

  it("la autoría de una repetición tampoco se puede falsear", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const id = randomUUID();
      await s.db.query("select ingest_timing_events($1::jsonb)", [
        lote(
          marcaje({
            id,
            laneId: lane,
            seq: 1,
            type: "rep",
            elapsedMs: 5000,
            // El cliente miente sobre quien la registro.
            ...{ recordedBy: s.users.headJudge },
          }),
        ),
      ]);

      const res = await s.db.query<{ recorded_by: string }>(
        "select recorded_by from timing_events where id = $1",
        [id],
      );
      expect(res.rows[0].recorded_by).toBe(s.users.judgeA);
    });
  });

  it("una repetición sigue siendo inmutable: nadie la edita ni la borra", async () => {
    const id = randomUUID();
    await asUser(s.db, s.users.judgeA, () =>
      s.db.query("select ingest_timing_events($1::jsonb)", [
        lote(marcaje({ id, laneId: lane, seq: 1, type: "rep", elapsedMs: 5000 })),
      ]),
    );

    // Ni el juez que la registró, ni la organización.
    for (const usuario of [s.users.judgeA, s.users.owner]) {
      await asUser(s.db, usuario, async () => {
        await expectDenied(() =>
          s.db.query("update timing_events set elapsed_ms = 1 where id = $1", [id]),
        );
        await expectDenied(() => s.db.query("delete from timing_events where id = $1", [id]));
      });
    }
  });

  it("anular una repetición pasa por la vía privilegiada y exige motivo", async () => {
    const id = randomUUID();
    await asUser(s.db, s.users.judgeA, () =>
      s.db.query("select ingest_timing_events($1::jsonb)", [
        lote(marcaje({ id, laneId: lane, seq: 1, type: "rep", elapsedMs: 5000 })),
      ]),
    );

    await asUser(s.db, s.users.headJudge, async () => {
      await s.db.query("select void_timing_event($1, $2)", [id, "Sin rango de movimiento"]);

      const res = await s.db.query<{ voided: boolean; elapsed_ms: number }>(
        "select voided, elapsed_ms from timing_events where id = $1",
        [id],
      );
      // Anular no borra: el marcaje sigue ahí para poder auditarlo.
      expect(res.rows[0].voided).toBe(true);
      expect(res.rows[0].elapsed_ms).toBe(5000);
    });
  });

  it("un juez ajeno no puede marcar repeticiones en un carril que no es suyo", async () => {
    await asUser(s.db, s.users.judgeB, () =>
      expectDenied(() =>
        s.db.query("select ingest_timing_events($1::jsonb)", [
          lote(
            marcaje({ id: randomUUID(), laneId: lane, seq: 1, type: "rep", elapsedMs: 1000 }),
          ),
        ]),
      ),
    );
  });
});
