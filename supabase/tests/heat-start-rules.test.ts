/**
 * Reglas de largada de un heat.
 *
 * La que manda: ningun atleta corre sin juez. Sin este control se podia largar
 * con carriles sin juez, y esos atletas quedaban corriendo sin que nadie tomara
 * sus parciales — al terminar no habia nada que reconstruir.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

/** Asigna juez a todos los carriles con atleta del heat. */
async function asignarJueces() {
  await asUser(s.db, s.users.judgeA, async () => {
    for (const lane of s.laneIds) {
      await s.db.query("select claim_lane($1)", [lane]);
    }
  });
}

describe("start_heat exige jueces", () => {
  it("no larga si falta juez en algun carril", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() => s.db.query("select start_heat($1)", [s.heatId]));
      expect(msg).toContain("Faltan jueces");
      expect(msg).toContain("3 de 3");
    });
  });

  it("tampoco larga si falta juez en UN solo carril", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select claim_lane($1)", [s.laneIds[0]]);
      await s.db.query("select claim_lane($1)", [s.laneIds[1]]);
    });

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() => s.db.query("select start_heat($1)", [s.heatId]));
      expect(msg).toContain("1 de 3");
    });
  });

  it("larga cuando todos tienen juez", async () => {
    await asignarJueces();
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ status: string }>("select status from start_heat($1)", [
        s.heatId,
      ]);
      expect(res.rows[0].status).toBe("running");
    });
  });

  // Un heat de 6 carriles con 4 atletas necesita 4 jueces, no 6.
  it("los carriles vacios no exigen juez", async () => {
    await asignarJueces();
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "insert into lanes (heat_id, event_id, lane_number) values ($1, $2, 9)",
        [s.heatId, s.eventId],
      );
      const res = await s.db.query<{ status: string }>("select status from start_heat($1)", [
        s.heatId,
      ]);
      expect(res.rows[0].status).toBe("running");
    });
  });

  it("no larga un heat sin ningun atleta", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const vacio = await s.db.query<{ id: string }>(
        "insert into heats (event_id, name, lane_count) values ($1, 'Heat vacio', 4) returning id",
        [s.eventId],
      );
      const msg = await expectDenied(() =>
        s.db.query("select start_heat($1)", [vacio.rows[0].id]),
      );
      expect(msg).toContain("atleta asignado");
    });
  });
});

describe("cancel_heat_start", () => {
  it("deshace una largada hecha por error", async () => {
    await asignarJueces();
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select start_heat($1)", [s.heatId]);

      const res = await s.db.query<{ status: string; started_at: string | null }>(
        "select status, started_at from cancel_heat_start($1)",
        [s.heatId],
      );
      expect(res.rows[0]).toMatchObject({ status: "scheduled", started_at: null });
    });
  });

  it("los carriles vuelven a estado inicial", async () => {
    await asignarJueces();
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select start_heat($1)", [s.heatId]);
      await s.db.query("select cancel_heat_start($1)", [s.heatId]);

      const res = await s.db.query<{ status: string }>(
        "select status from lanes where heat_id = $1",
        [s.heatId],
      );
      expect(res.rows.every((r) => r.status === "idle")).toBe(true);
    });
  });

  // Deshacer con marcajes ya tomados dejaria los parciales colgando de un cero
  // que ya no existe.
  it("NO deshace si ya hay marcajes", async () => {
    await asignarJueces();
    await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));

    await asUser(s.db, s.users.judgeA, () =>
      s.db.query("select ingest_timing_events($1::jsonb)", [
        JSON.stringify([
          {
            id: "22222222-2222-4222-8222-222222222222",
            laneId: s.laneIds[0],
            seq: 1,
            type: "segment_split",
            elapsedMs: 5000,
            payload: {},
            deviceId: "d",
          },
        ]),
      ]),
    );

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select cancel_heat_start($1)", [s.heatId]),
      );
      expect(msg).toContain("no se puede deshacer");
    });
  });

  it("un juez comun no puede deshacer la largada", async () => {
    await asignarJueces();
    await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));

    await asUser(s.db, s.users.judgeB, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select cancel_heat_start($1)", [s.heatId]),
      );
      expect(msg).toContain("permiso");
    });
  });
});
