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

describe("start_heat exige que los jueces no esten ocupados en otro heat en curso", () => {
  it("no larga un segundo heat con un juez que ya esta en el primero", async () => {
    await asignarJueces();
    await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));

    await asUser(s.db, s.users.owner, async () => {
      // Un equipo NUEVO: los tres del fixture ya corren en s.heatId, y un
      // equipo no puede correr dos veces la misma prueba.
      const equipo2 = await s.db.query<{ id: string }>(
        "insert into teams (event_id, division_id, bib_number) values ($1, $2, 200) returning id",
        [s.eventId, s.divisionId],
      );

      const heat2 = await s.db.query<{ id: string }>(
        "insert into heats (event_id, name, lane_count) values ($1, 'Heat 2', 1) returning id",
        [s.eventId],
      );
      const lane2 = await s.db.query<{ id: string }>(
        `insert into lanes (heat_id, event_id, lane_number, team_id)
         values ($1, $2, 1, $3) returning id`,
        [heat2.rows[0].id, s.eventId, equipo2.rows[0].id],
      );

      // El organizador PRE-ASIGNA (no es judgeA autoclamando): es el
      // escenario real reportado, un juez asignado con anticipacion a dos
      // heats que terminan solapando.
      await s.db.query("select transfer_lane($1, $2, null)", [lane2.rows[0].id, s.users.judgeA]);

      const msg = await expectDenied(() =>
        s.db.query("select start_heat($1)", [heat2.rows[0].id]),
      );
      expect(msg).toContain("Ya están en otro heat en curso");
    });
  });

  it("larga sin problema si el otro heat ya terminó (ended_at)", async () => {
    await asignarJueces();
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select start_heat($1)", [s.heatId]);
      await s.db.query("update heats set ended_at = now() where id = $1", [s.heatId]);

      const equipo2 = await s.db.query<{ id: string }>(
        "insert into teams (event_id, division_id, bib_number) values ($1, $2, 201) returning id",
        [s.eventId, s.divisionId],
      );

      const heat2 = await s.db.query<{ id: string }>(
        "insert into heats (event_id, name, lane_count) values ($1, 'Heat 2', 1) returning id",
        [s.eventId],
      );
      const lane2 = await s.db.query<{ id: string }>(
        `insert into lanes (heat_id, event_id, lane_number, team_id)
         values ($1, $2, 1, $3) returning id`,
        [heat2.rows[0].id, s.eventId, equipo2.rows[0].id],
      );
      await s.db.query("update lanes set judge_id = $1 where id = $2", [
        s.users.judgeA,
        lane2.rows[0].id,
      ]);

      const res = await s.db.query<{ status: string }>("select status from start_heat($1)", [
        heat2.rows[0].id,
      ]);
      expect(res.rows[0].status).toBe("running");
    });
  });

  it("cubrir varios carriles del MISMO heat no cuenta como estar ocupado", async () => {
    // asignarJueces() ya pone al mismo juez en los 3 carriles de s.heatId:
    // si esto no funcionara, ningun heat de este fixture podria largar.
    await asignarJueces();
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ status: string }>("select status from start_heat($1)", [
        s.heatId,
      ]);
      expect(res.rows[0].status).toBe("running");
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
