/**
 * Formato de los marcajes tal como los manda el cliente REAL.
 *
 * El fixture marcaje() usaba ISO string para clientCapturedAt, pero el cliente
 * manda Date.now() (un numero). Los tests pasaban y produccion fallaba.
 */

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { asUser } from "./harness";
import { asignarJueces, seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
  await asignarJueces(s);
  await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));
});

/** Exactamente lo que produce toDomainEvent() en src/features/judge/lib/sync.ts. */
function comoLoMandaElCliente(laneId: string) {
  return {
    id: randomUUID(),
    laneId,
    seq: 1,
    type: "segment_split",
    segmentId: null,
    elapsedMs: 125_000,
    payload: {},
    recordedBy: "algo-que-el-servidor-ignora",
    deviceId: "abc-123",
    clientCapturedAt: Date.now(), // NUMERO, no string ISO
    supersedesId: null,
    voided: false,
    voidReason: null,
  };
}

describe("payload del cliente real", () => {
  it("acepta clientCapturedAt como epoch en milisegundos", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [JSON.stringify([comoLoMandaElCliente(s.laneIds[0])])],
      );
      expect(res.rows[0].accepted).toBe(true);
    });
  });

  it("acepta tambien ISO string, por si algun cliente lo manda asi", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const evento = {
        ...comoLoMandaElCliente(s.laneIds[0]),
        clientCapturedAt: new Date().toISOString(),
      };
      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [JSON.stringify([evento])],
      );
      expect(res.rows[0].accepted).toBe(true);
    });
  });

  it("acepta el campo vacio o ausente", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const evento = comoLoMandaElCliente(s.laneIds[0]);
      delete (evento as Record<string, unknown>).clientCapturedAt;
      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [JSON.stringify([evento])],
      );
      expect(res.rows[0].accepted).toBe(true);
    });
  });
});

describe("elapsedMs con decimales", () => {
  // performance.now() tiene precision sub-milisegundo, asi que el elapsed que
  // calcula el cronometro es un decimal. La columna es int.
  it("acepta un elapsed fraccionario y lo redondea", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const evento = { ...comoLoMandaElCliente(s.laneIds[0]), elapsedMs: 190177.19999992847 };
      const res = await s.db.query<{ accepted: boolean }>(
        "select accepted from ingest_timing_events($1::jsonb)",
        [JSON.stringify([evento])],
      );
      expect(res.rows[0].accepted).toBe(true);

      const guardado = await s.db.query<{ elapsed_ms: number }>(
        "select elapsed_ms from timing_events where id = $1",
        [evento.id],
      );
      expect(guardado.rows[0].elapsed_ms).toBe(190177);
    });
  });

  it("redondea, no trunca: truncar sesgaria todos los tiempos hacia abajo", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const evento = { ...comoLoMandaElCliente(s.laneIds[0]), elapsedMs: 1000.7 };
      await s.db.query("select ingest_timing_events($1::jsonb)", [JSON.stringify([evento])]);

      const guardado = await s.db.query<{ elapsed_ms: number }>(
        "select elapsed_ms from timing_events where id = $1",
        [evento.id],
      );
      expect(guardado.rows[0].elapsed_ms).toBe(1001);
    });
  });

  it("rechaza un elapsed negativo", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const evento = { ...comoLoMandaElCliente(s.laneIds[0]), elapsedMs: -5 };
      await expect(
        s.db.query("select ingest_timing_events($1::jsonb)", [JSON.stringify([evento])]),
      ).rejects.toThrow(/negativo/);
    });
  });
});
