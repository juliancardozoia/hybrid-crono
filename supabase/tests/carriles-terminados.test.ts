/**
 * Un carril con resultado terminal desaparece solo de `judge_visible_lanes()`
 * — ni en "tuyos" ni en "libres" — y `judge_lane_events()` es lo que le
 * permite al juez enterarse de un evento que insertó otra persona (la
 * organización desde la torre de control, por ejemplo un DNF).
 */

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asUser } from "./harness";
import { asignarJueces, seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let lane: string;

beforeEach(async () => {
  s = await seedScenario();
  lane = s.laneIds[0];
  await asignarJueces(s);
  await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));
});

async function carrilesVisiblesPara(userId: string) {
  return asUser(s.db, userId, () =>
    s.db.query<{ lane_id: string }>("select lane_id from judge_visible_lanes()"),
  );
}

describe("un carril terminado se protege", () => {
  it("desaparece de 'tuyos' apenas el resultado del circuito es terminal", async () => {
    const antes = await carrilesVisiblesPara(s.users.judgeA);
    expect(antes.rows.map((r) => r.lane_id)).toContain(lane);

    await asAdmin(s.db, () =>
      s.db.query(
        `insert into results (lane_id, event_id, heat_id, status)
         values ($1, $2, $3, 'finished')`,
        [lane, s.eventId, s.heatId],
      ),
    );

    const despues = await carrilesVisiblesPara(s.users.judgeA);
    expect(despues.rows.map((r) => r.lane_id)).not.toContain(lane);
  });

  it("tampoco aparece en 'libres' para que otro juez lo tome", async () => {
    await asAdmin(s.db, () =>
      s.db.query(
        `insert into results (lane_id, event_id, heat_id, status)
         values ($1, $2, $3, 'dnf')`,
        [lane, s.eventId, s.heatId],
      ),
    );

    // judgeB nunca tomó este carril: si estuviera "libre" lo vería acá.
    const paraOtro = await carrilesVisiblesPara(s.users.judgeB);
    expect(paraOtro.rows.map((r) => r.lane_id)).not.toContain(lane);
  });

  it("un resultado 'running' (no terminal) lo sigue mostrando", async () => {
    await asAdmin(s.db, () =>
      s.db.query(
        `insert into results (lane_id, event_id, heat_id, status)
         values ($1, $2, $3, 'running')`,
        [lane, s.eventId, s.heatId],
      ),
    );

    const visibles = await carrilesVisiblesPara(s.users.judgeA);
    expect(visibles.rows.map((r) => r.lane_id)).toContain(lane);
  });
});

describe("judge_lane_events", () => {
  it("devuelve los eventos del carril, incluidos los que insertó otra persona", async () => {
    // El juez marca la largada (idempotente, la agrega el store igual).
    await asUser(s.db, s.users.judgeA, () =>
      s.db.query("select ingest_timing_events($1::jsonb)", [
        JSON.stringify([
          {
            id: randomUUID(),
            laneId: lane,
            seq: 1,
            type: "lane_start",
            elapsedMs: 0,
            payload: {},
          },
        ]),
      ]),
    );

    // La organización marca DNF desde la torre de control — mismo patrón que
    // `marcarDnf` en el panel: otro dispositivo, otro seq.
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select ingest_timing_events($1::jsonb)", [
        JSON.stringify([
          {
            id: randomUUID(),
            laneId: lane,
            seq: 1_000_000,
            type: "dnf",
            elapsedMs: 45_000,
            payload: {},
            deviceId: "panel-organizador",
          },
        ]),
      ]),
    );

    // El JUEZ (no la organización) pide los eventos de su propio carril: la
    // función tiene que devolver el DNF que el ORGANIZADOR insertó, no solo
    // lo que el juez ya tenía.
    const { rows } = await asUser(s.db, s.users.judgeA, () =>
      s.db.query<{ type: string; device_id: string | null }>(
        "select type, device_id from judge_lane_events($1)",
        [lane],
      ),
    );

    const tipos = rows.map((r) => r.type);
    expect(tipos).toContain("lane_start");
    expect(tipos).toContain("dnf");
    expect(rows.find((r) => r.type === "dnf")?.device_id).toBe("panel-organizador");
  });

  it("un ajeno a la organización no ve nada", async () => {
    const { rows } = await asUser(s.db, s.users.forastero, () =>
      s.db.query("select * from judge_lane_events($1)", [lane]),
    );
    expect(rows).toHaveLength(0);
  });
});
