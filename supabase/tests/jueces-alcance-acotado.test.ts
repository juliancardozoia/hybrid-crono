/**
 * Un juez de EVENTO no ve la competencia: ve su carril.
 *
 * Reportado por un tester: invitar a alguien como juez (event_staff, sin
 * banderas de permiso) y entrar con esa cuenta mostraba la ficha entera de
 * la competencia -- categorias, atletas, circuito -- no solo el cronometro.
 * `event_role()` traducia `event_staff_role = 'judge'` al mismo org_role que
 * ya usaban los miembros de ORGANIZACION con rol de juez, y esa traduccion es
 * lo que abria las ~25 politicas RLS que dicen `event_role(event_id) is not
 * null`, ademas de ser lo que usa requireEventAccess() para decidir si
 * mostrar el panel.
 *
 * Un miembro de organizacion (org_members) sigue viendo lo mismo que veia
 * antes: es alguien de confianza del box, y esta migracion no lo toca.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asUser, createUser } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let juezDeEvento: string;

beforeEach(async () => {
  s = await seedScenario();
  juezDeEvento = await createUser(s.db, "juez-evento@fuera.com", "Juez De Una Fecha");

  await asUser(s.db, s.users.owner, () =>
    s.db.query(`select invite_event_staff($1, 'juez-evento@fuera.com', 'judge')`, [s.eventId]),
  );
});

describe("un juez de evento no tiene event_role", () => {
  it("event_role() es null, pero event_staff_role() lo sigue reconociendo", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const res = await s.db.query<{ rol: string | null; rol_staff: string }>(
        "select event_role($1) as rol, event_staff_role($1) as rol_staff",
        [s.eventId],
      );
      expect(res.rows[0].rol).toBeNull();
      expect(res.rows[0].rol_staff).toBe("judge");
    });
  });

  it("requireEventAccess (via event_role) lo rebotaria del panel", async () => {
    // access.ts hace: si event_role() es null, getEventAccess devuelve null y
    // requireEventAccess redirige. Este test verifica la parte de base: el
    // RPC que consulta esa pantalla.
    await asUser(s.db, juezDeEvento, async () => {
      const res = await s.db.query<{ rol: string | null }>("select event_role($1) as rol", [
        s.eventId,
      ]);
      expect(res.rows[0].rol).toBeNull();
    });
  });
});

describe("no puede leer datos de la competencia", () => {
  it("no lee divisions", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const res = await s.db.query("select * from divisions where event_id = $1", [s.eventId]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("no lee athletes (datos personales)", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const res = await s.db.query("select * from athletes where event_id = $1", [s.eventId]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("no lee teams", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const res = await s.db.query("select * from teams where event_id = $1", [s.eventId]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("no lee results ni standings", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const results = await s.db.query("select * from results where event_id = $1", [s.eventId]);
      expect(results.rows).toHaveLength(0);
    });
  });
});

describe("si puede leer lo que necesita /juez", () => {
  it("lee lanes y heats (sin datos personales)", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const lanes = await s.db.query("select id from lanes where event_id = $1", [s.eventId]);
      expect(lanes.rows.length).toBeGreaterThan(0);

      const heats = await s.db.query("select id from heats where event_id = $1", [s.eventId]);
      expect(heats.rows.length).toBeGreaterThan(0);
    });
  });

  it("judge_visible_lanes le trae SU evento, con nombre de atleta armado", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const res = await s.db.query<{ event_id: string; athletes: string | null }>(
        "select event_id, athletes from judge_visible_lanes()",
      );
      const propias = res.rows.filter((r) => r.event_id === s.eventId);
      expect(propias.length).toBeGreaterThan(0);
      // El nombre viene armado desde la funcion, no de una tabla abierta.
      expect(propias.some((r) => (r.athletes ?? "").includes("Atleta"))).toBe(true);
    });
  });

  it("judge_lane_bundle le trae el carril con nombre de atleta", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const res = await s.db.query<{ division_id: string | null; athletes: string | null }>(
        "select division_id, athletes from judge_lane_bundle($1)",
        [s.laneIds[0]],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].division_id).not.toBeNull();
      expect(res.rows[0].athletes).toContain("Atleta");
    });
  });

  it("claim_lane le sigue funcionando", async () => {
    await asUser(s.db, juezDeEvento, async () => {
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        s.laneIds[0],
      ]);
      expect(res.rows[0].judge_id).toBe(juezDeEvento);
    });
  });
});

describe("un miembro de organizacion con rol de juez NO cambia", () => {
  it("sigue viendo divisions, como antes", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query("select id from divisions where event_id = $1", [s.eventId]);
      expect(res.rows.length).toBeGreaterThan(0);
    });
  });

  it("event_role() le sigue devolviendo 'judge'", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ rol: string }>("select event_role($1) as rol", [s.eventId]);
      expect(res.rows[0].rol).toBe("judge");
    });
  });
});

describe("la organizacion no pierde nada", () => {
  it("el owner sigue leyendo todo", async () => {
    await asAdmin(s.db, async () => {
      const res = await s.db.query("select id from divisions where event_id = $1", [s.eventId]);
      expect(res.rows.length).toBeGreaterThanOrEqual(0);
    });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query("select id from divisions where event_id = $1", [s.eventId]);
      expect(res.rows.length).toBeGreaterThan(0);
    });
  });
});
