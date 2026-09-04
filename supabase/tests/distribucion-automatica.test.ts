/**
 * Distribución automática de heats: numerados por categoría, con jueces al
 * azar entre los ya cargados, y recalculable sin duplicar ni tocar lo que
 * ya arrancó.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
  // seedScenario ya invita a judgeA y judgeB como org_members con rol
  // "judge", pero auto_distribuir_heats saca su pool de event_staff. Se
  // invita a uno explícito para que el sorteo tenga de dónde elegir.
  await asUser(s.db, s.users.owner, () =>
    s.db.query(`select invite_event_staff($1, 'juez.a@box.com', 'judge')`, [s.eventId]),
  );
});

describe("auto_distribuir_heats", () => {
  it("exige permiso de gestión", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select * from auto_distribuir_heats($1, 2)", [s.eventId]),
      );
      expect(msg).toContain("Solo la organización");
    });
  });

  it("rechaza una cantidad de carriles fuera de rango", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select * from auto_distribuir_heats($1, 0)", [s.eventId]),
      );
      expect(msg).toContain("entre 1 y 32");
    });
  });

  it("exige al menos un juez cargado", async () => {
    // Se quita al único juez de event_staff que armó beforeEach. `event_staff`
    // no tiene grant de delete para authenticated -- las bajas pasan por
    // remove_event_staff() -- asi que esto se hace como admin.
    await asAdmin(s.db, () => s.db.query("delete from event_staff where event_id = $1", [s.eventId]));

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select * from auto_distribuir_heats($1, 2)", [s.eventId]),
      );
      expect(msg).toContain("jueces");
    });
  });

  it("reparte los 3 equipos del fixture en heats de a 2 carriles, numerados desde 1", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{
        division_id: string;
        heats_creados: number;
        equipos_asignados: number;
      }>("select * from auto_distribuir_heats($1, 2)", [s.eventId]);

      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]).toMatchObject({
        division_id: s.divisionId,
        heats_creados: 2, // 3 equipos / 2 carriles -> ceil = 2 heats
        equipos_asignados: 3,
      });

      const nombres = await s.db.query<{ name: string }>(
        "select name from heats where event_id = $1 order by name",
        [s.eventId],
      );
      expect(nombres.rows.map((r) => r.name)).toEqual(["Heat 1", "Heat 2"]);
    });
  });

  it("todos los carriles con equipo quedan con un juez asignado", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select * from auto_distribuir_heats($1, 2)", [s.eventId]);

      const lanes = await s.db.query<{ judge_id: string | null }>(
        "select judge_id from lanes where event_id = $1 and team_id is not null",
        [s.eventId],
      );
      expect(lanes.rows.length).toBe(3);
      expect(lanes.rows.every((l) => l.judge_id !== null)).toBe(true);
    });
  });

  it("no reparte equipos retirados", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update teams set status = 'withdrawn' where id = $1", [s.teamIds[0]]);

      const res = await s.db.query<{ equipos_asignados: number }>(
        "select * from auto_distribuir_heats($1, 6)",
        [s.eventId],
      );
      expect(res.rows[0].equipos_asignados).toBe(2);
    });
  });

  it("dos categorías distintas pueden tener las dos un 'Heat 1'", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const otraDivision = await s.db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Elite Femenino', 1, 'female',
                 (select course_template_id from divisions where id = $2))
         returning id`,
        [s.eventId, s.divisionId],
      );

      const atleta = await s.db.query<{ id: string }>(
        `insert into athletes (event_id, first_name, last_name, gender)
         values ($1, 'Otra', 'Atleta', 'female') returning id`,
        [s.eventId],
      );
      const equipo = await s.db.query<{ id: string }>(
        "insert into teams (event_id, division_id, bib_number) values ($1, $2, 500) returning id",
        [s.eventId, otraDivision.rows[0].id],
      );
      await s.db.query("insert into team_members (team_id, athlete_id, event_id) values ($1, $2, $3)", [
        equipo.rows[0].id,
        atleta.rows[0].id,
        s.eventId,
      ]);

      const res = await s.db.query("select * from auto_distribuir_heats($1, 6)", [s.eventId]);
      expect(res.rows).toHaveLength(2);

      const nombres = await s.db.query<{ name: string; division_id: string }>(
        "select name, division_id from heats where event_id = $1 order by division_id",
        [s.eventId],
      );
      // Una fila "Heat 1" por cada una de las dos categorías -- antes esto
      // chocaba contra `unique (event_id, name)`.
      expect(nombres.rows.filter((r) => r.name === "Heat 1")).toHaveLength(2);
    });
  });

  it("recalcula al correrlo de nuevo: no duplica, incluye equipos nuevos", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select * from auto_distribuir_heats($1, 2)", [s.eventId]);

      // Un cuarto equipo se suma despues de la primera corrida.
      const atleta = await s.db.query<{ id: string }>(
        `insert into athletes (event_id, first_name, last_name, gender)
         values ($1, 'Atleta4', 'Perez', 'male') returning id`,
        [s.eventId],
      );
      const equipo = await s.db.query<{ id: string }>(
        "insert into teams (event_id, division_id, bib_number) values ($1, $2, 104) returning id",
        [s.eventId, s.divisionId],
      );
      await s.db.query("insert into team_members (team_id, athlete_id, event_id) values ($1, $2, $3)", [
        equipo.rows[0].id,
        atleta.rows[0].id,
        s.eventId,
      ]);

      const res = await s.db.query<{ equipos_asignados: number }>(
        "select * from auto_distribuir_heats($1, 2)",
        [s.eventId],
      );
      expect(res.rows[0].equipos_asignados).toBe(4);

      const heats = await s.db.query<{ id: string }>("select id from heats where event_id = $1", [
        s.eventId,
      ]);
      expect(heats.rows).toHaveLength(2); // ceil(4/2), no 4 (2 de la corrida vieja + 2 nuevos)
    });
  });

});

describe("el nombre de un heat es único por categoría, no por evento", () => {
  // El fixture ya crea un heat "Heat 1" en s.divisionId (s.heatId): estos
  // tests parten de esa fila en vez de crear una nueva con el mismo nombre,
  // que chocaria antes de que el test llegue a probar nada.
  it("el mismo nombre choca dentro de la misma categoría", async () => {
    await asAdmin(s.db, async () => {
      await expectDenied(() =>
        s.db.query(
          "insert into heats (event_id, division_id, name, lane_count) values ($1, $2, 'Heat 1', 3)",
          [s.eventId, s.divisionId],
        ),
      );
    });
  });

  it("el mismo nombre NO choca entre categorías distintas", async () => {
    await asAdmin(s.db, async () => {
      const otraDivision = await s.db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Otra', 1, 'female', (select course_template_id from divisions where id = $2))
         returning id`,
        [s.eventId, s.divisionId],
      );

      // No debe lanzar, aunque s.divisionId ya tenga su propio "Heat 1".
      await s.db.query(
        "insert into heats (event_id, division_id, name, lane_count) values ($1, $2, 'Heat 1', 3)",
        [s.eventId, otraDivision.rows[0].id],
      );

      const res = await s.db.query("select id from heats where event_id = $1 and name = 'Heat 1'", [
        s.eventId,
      ]);
      expect(res.rows).toHaveLength(2);
    });
  });
});

describe("auto_distribuir_heats: recalculo sin pisar lo que ya arrancó", () => {
  it("no toca un heat que ya largó, y numera el resto esquivando su nombre", async () => {
    // s.heatId ("Heat 1") ya trae los 3 equipos del fixture, uno por carril.
    // Se suma un CUARTO equipo, todavía sin heat, para tener algo que
    // redistribuir una vez que "Heat 1" pase a estar en curso.
    await asAdmin(s.db, async () => {
      const atleta = await s.db.query<{ id: string }>(
        `insert into athletes (event_id, first_name, last_name, gender)
         values ($1, 'Atleta4', 'Perez', 'male') returning id`,
        [s.eventId],
      );
      const equipo = await s.db.query<{ id: string }>(
        "insert into teams (event_id, division_id, bib_number) values ($1, $2, 104) returning id",
        [s.eventId, s.divisionId],
      );
      await s.db.query(
        "insert into team_members (team_id, athlete_id, event_id) values ($1, $2, $3)",
        [equipo.rows[0].id, atleta.rows[0].id, s.eventId],
      );
    });

    await asUser(s.db, s.users.owner, async () => {
      const lane1 = await s.db.query<{ id: string }>(
        "select id from lanes where heat_id = $1 and lane_number = 1",
        [s.heatId],
      );
      await s.db.query("select claim_lane($1)", [lane1.rows[0].id]);
    });

    await asAdmin(s.db, () =>
      s.db.query("update heats set started_at = now(), start_source = 'server' where id = $1", [
        s.heatId,
      ]),
    );

    await asUser(s.db, s.users.owner, async () => {
      // Los 3 equipos de "Heat 1" ya arrancaron y se quedan donde estan: solo
      // el cuarto, todavia suelto, se redistribuye. La numeracion nueva tiene
      // que esquivar "Heat 1", que ya esta tomado.
      const res = await s.db.query<{ heats_creados: number; equipos_asignados: number }>(
        "select * from auto_distribuir_heats($1, 1)",
        [s.eventId],
      );
      expect(res.rows[0].equipos_asignados).toBe(1);

      const nombres = await s.db.query<{ name: string; started_at: string | null }>(
        "select name, started_at from heats where event_id = $1 order by name",
        [s.eventId],
      );
      expect(nombres.rows.map((r) => r.name)).toEqual(["Heat 1", "Heat 2"]);
      expect(nombres.rows.find((r) => r.name === "Heat 1")?.started_at).not.toBeNull();
    });
  });
});
