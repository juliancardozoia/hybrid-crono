/**
 * Un corte reduce quien sigue compitiendo, pero nunca reinicia los puntos ni
 * deja competir a quien quedo afuera.
 *
 * Este archivo cubre la parte que vive en Postgres: `confirmar_corte_de_etapa`
 * (quien avanza queda registrado y no se puede rehacer) y la garantia nueva de
 * que un equipo eliminado no vuelve a ser elegible para un heat de la etapa
 * siguiente -- ni asignandolo a mano (`assign_heat_lanes`) ni con la
 * distribucion automatica (`auto_distribuir_heats`). El calculo del
 * leaderboard acumulado (que un corte no reinicia los puntos) esta cubierto
 * en `src/shared/scoring/scoreboard.test.ts`, que es codigo puro y no
 * necesita Postgres.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
  await asUser(s.db, s.users.owner, () =>
    s.db.query(`select invite_event_staff($1, 'juez.a@box.com', 'judge')`, [s.eventId]),
  );
});

/** Suma una prueba de una etapa concreta, con su parte y la categoria del fixture inscripta. */
async function crearPruebaDeEtapa(nombre: string, orden: number, stage: number): Promise<string> {
  let workoutId = "";
  await asUser(s.db, s.users.owner, async () => {
    const w = await s.db.query<{ id: string }>(
      "insert into workouts (event_id, order_index, name, stage) values ($1, $2, $3, $4) returning id",
      [s.eventId, orden, nombre, stage],
    );
    workoutId = w.rows[0].id;

    const p = await s.db.query<{ id: string }>(
      `insert into workout_parts (workout_id, event_id, order_index, time_scheme, score_unit, score_dir)
       values ($1, $2, 0, 'cap', 'tiempo', 'menor_gana') returning id`,
      [workoutId, s.eventId],
    );

    await s.db.query("insert into part_divisions (part_id, division_id, event_id) values ($1, $2, $3)", [
      p.rows[0].id,
      s.divisionId,
      s.eventId,
    ]);
  });
  return workoutId;
}

async function confirmarCorte(stage: number, teamIds: string[]): Promise<void> {
  await asUser(s.db, s.users.owner, () =>
    s.db.query("select confirmar_corte_de_etapa($1, $2, $3, $4)", [
      s.divisionId,
      stage,
      teamIds,
      teamIds.map(() => 100),
    ]),
  );
}

describe("confirmar_corte_de_etapa", () => {
  it("exige permiso de gestion", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select confirmar_corte_de_etapa($1, 2, $2, $3)", [
          s.divisionId,
          [s.teamIds[0]],
          [100],
        ]),
      );
      expect(msg).toContain("No tienes permiso");
    });
  });

  it("registra quien avanza", async () => {
    await confirmarCorte(2, [s.teamIds[0], s.teamIds[1]]);

    const avanzan = await asUser(s.db, s.users.owner, () =>
      s.db.query<{ team_id: string }>(
        "select team_id from stage_advancements where division_id = $1 and stage = 2 order by team_id",
        [s.divisionId],
      ),
    );
    expect(avanzan.rows.map((r) => r.team_id).sort()).toEqual(
      [s.teamIds[0], s.teamIds[1]].sort(),
    );
  });

  it("un corte ya confirmado no se puede rehacer", async () => {
    await confirmarCorte(2, [s.teamIds[0]]);

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select confirmar_corte_de_etapa($1, 2, $2, $3)", [
          s.divisionId,
          [s.teamIds[1]],
          [100],
        ]),
      );
      expect(msg).toContain("no se puede rehacer");
    });
  });
});

describe("un corte excluye a los eliminados de los heats de la etapa siguiente", () => {
  it("assign_heat_lanes rechaza un equipo que no avanzo al corte de esa etapa", async () => {
    const final = await crearPruebaDeEtapa("Final", 1, 2);
    // Solo teamIds[0] avanza.
    await confirmarCorte(2, [s.teamIds[0]]);

    await asUser(s.db, s.users.owner, async () => {
      const heat = await s.db.query<{ id: string }>(
        `insert into heats (event_id, division_id, workout_id, name, lane_count)
         values ($1, $2, $3, 'Heat 1', 2) returning id`,
        [s.eventId, s.divisionId, final],
      );

      // teamIds[1] no avanzo: no puede entrar a un carril de la final.
      const msg = await expectDenied(() =>
        s.db.query("select assign_heat_lanes($1, $2)", [
          heat.rows[0].id,
          [s.teamIds[0], s.teamIds[1]],
        ]),
      );
      expect(msg).toContain("no avanzaron al corte de esta etapa");
    });
  });

  it("assign_heat_lanes acepta a quien SI avanzo", async () => {
    const final = await crearPruebaDeEtapa("Final", 1, 2);
    await confirmarCorte(2, [s.teamIds[0], s.teamIds[1]]);

    await asUser(s.db, s.users.owner, async () => {
      const heat = await s.db.query<{ id: string }>(
        `insert into heats (event_id, division_id, workout_id, name, lane_count)
         values ($1, $2, $3, 'Heat 1', 2) returning id`,
        [s.eventId, s.divisionId, final],
      );

      await s.db.query("select assign_heat_lanes($1, $2)", [
        heat.rows[0].id,
        [s.teamIds[0], s.teamIds[1]],
      ]);

      const lanes = await s.db.query<{ team_id: string }>(
        "select team_id from lanes where heat_id = $1 order by lane_number",
        [heat.rows[0].id],
      );
      expect(lanes.rows.map((r) => r.team_id)).toEqual([s.teamIds[0], s.teamIds[1]]);
    });
  });

  it("sin corte confirmado, nadie es elegible todavia para un heat de esa etapa", async () => {
    const final = await crearPruebaDeEtapa("Final", 1, 2);

    await asUser(s.db, s.users.owner, async () => {
      const heat = await s.db.query<{ id: string }>(
        `insert into heats (event_id, division_id, workout_id, name, lane_count)
         values ($1, $2, $3, 'Heat 1', 2) returning id`,
        [s.eventId, s.divisionId, final],
      );

      const msg = await expectDenied(() =>
        s.db.query("select assign_heat_lanes($1, $2)", [heat.rows[0].id, [s.teamIds[0]]]),
      );
      expect(msg).toContain("no avanzaron al corte de esta etapa");
    });
  });

  it("un heat de la etapa 1 no tiene restriccion: cualquier equipo activo entra", async () => {
    // El fixture ya metio a los 3 equipos en "Heat 1" del circuito: se suman
    // dos equipos nuevos para este heat, sin eso chocarian con
    // lanes_team_once_per_workout (un equipo no corre dos veces la misma
    // prueba).
    const circuito = (
      await asUser(s.db, s.users.owner, () =>
        s.db.query<{ id: string }>(
          "select id from workouts where event_id = $1 order by order_index limit 1",
          [s.eventId],
        ),
      )
    ).rows[0].id;

    const nuevos: string[] = [];
    await asUser(s.db, s.users.owner, async () => {
      for (let i = 0; i < 2; i++) {
        const atleta = await s.db.query<{ id: string }>(
          `insert into athletes (event_id, first_name, last_name, gender)
           values ($1, $2, 'Nuevo', 'male') returning id`,
          [s.eventId, `Extra${i}`],
        );
        const equipo = await s.db.query<{ id: string }>(
          "insert into teams (event_id, division_id, bib_number) values ($1, $2, $3) returning id",
          [s.eventId, s.divisionId, 300 + i],
        );
        nuevos.push(equipo.rows[0].id);
        await s.db.query("insert into team_members (team_id, athlete_id, event_id) values ($1, $2, $3)", [
          equipo.rows[0].id,
          atleta.rows[0].id,
          s.eventId,
        ]);
      }

      const heat = await s.db.query<{ id: string }>(
        `insert into heats (event_id, division_id, workout_id, name, lane_count)
         values ($1, $2, $3, 'Heat 9', 2) returning id`,
        [s.eventId, s.divisionId, circuito],
      );

      // Ningun corte confirmado todavia -- la etapa 1 no lo necesita.
      await s.db.query("select assign_heat_lanes($1, $2)", [heat.rows[0].id, nuevos]);

      const lanes = await s.db.query<{ team_id: string }>(
        "select team_id from lanes where heat_id = $1",
        [heat.rows[0].id],
      );
      expect(lanes.rows).toHaveLength(2);
    });
  });

  it("auto_distribuir_heats solo reparte carriles de la final entre quienes avanzaron", async () => {
    const final = await crearPruebaDeEtapa("Final", 1, 2);
    // teamIds[0] y teamIds[1] avanzan; teamIds[2] queda eliminado.
    await confirmarCorte(2, [s.teamIds[0], s.teamIds[1]]);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ equipos_asignados: number }>(
        "select * from auto_distribuir_heats($1, 3, $2)",
        [s.eventId, final],
      );
      expect(res.rows[0].equipos_asignados).toBe(2);

      const lanes = await s.db.query<{ team_id: string }>(
        "select l.team_id from lanes l join heats h on h.id = l.heat_id where h.workout_id = $1",
        [final],
      );
      expect(lanes.rows.map((r) => r.team_id).sort()).toEqual(
        [s.teamIds[0], s.teamIds[1]].sort(),
      );
      expect(lanes.rows.some((r) => r.team_id === s.teamIds[2])).toBe(false);
    });
  });

  it("auto_distribuir_heats de la final no arma nada si el corte todavia no se confirmo", async () => {
    const final = await crearPruebaDeEtapa("Final", 1, 2);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query("select * from auto_distribuir_heats($1, 3, $2)", [
        s.eventId,
        final,
      ]);
      expect(res.rows).toHaveLength(0);
    });
  });
});
