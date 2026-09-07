/**
 * Un heat corre SU prueba, no siempre la primera del evento.
 *
 * El bug que cubre: `heats.workout_id` es NOT NULL y lo rellenaba un trigger
 * con "la primera prueba del evento", porque nadie se la pasaba nunca. Con una
 * sola prueba —toda carrera hibrida— eso es correcto. Con varias, TODOS los
 * heats del CrossFit quedaban atados al WOD 1: los jueces abrian el WOD 1 y los
 * scores de las tres pruebas se escribian contra la primera, sin un solo error
 * a la vista.
 *
 * La mitad de este archivo son regresiones de la carrera hibrida. Van primero a
 * proposito: el formato que ya corre en competencia real no se puede mover.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
  // El pool de la distribucion automatica sale de event_staff, no de
  // org_members. Sin al menos uno, los carriles quedan sin juez y start_heat
  // no deja largar.
  await asUser(s.db, s.users.owner, () =>
    s.db.query(`select invite_event_staff($1, 'juez.a@box.com', 'judge')`, [s.eventId]),
  );
});

/** La prueba que `ensure_circuit_part()` le creo sola al evento del fixture. */
async function pruebaDelCircuito(): Promise<string> {
  const res = await asUser(s.db, s.users.owner, () =>
    s.db.query<{ id: string }>(
      "select id from workouts where event_id = $1 order by order_index limit 1",
      [s.eventId],
    ),
  );
  return res.rows[0].id;
}

/**
 * Suma una prueba mas al evento, con su parte y la categoria del fixture
 * inscripta. `capture_mode` queda en su default ('manual') a proposito: poner
 * 'en_vivo' dispararia el gate de plan, que no es lo que este archivo prueba.
 */
async function crearPrueba(nombre: string, orden: number, conCategoria = true): Promise<string> {
  let workoutId = "";
  await asUser(s.db, s.users.owner, async () => {
    const w = await s.db.query<{ id: string }>(
      "insert into workouts (event_id, order_index, name) values ($1, $2, $3) returning id",
      [s.eventId, orden, nombre],
    );
    workoutId = w.rows[0].id;

    const p = await s.db.query<{ id: string }>(
      `insert into workout_parts (workout_id, event_id, order_index, time_scheme, score_unit, score_dir)
       values ($1, $2, 0, 'cap', 'tiempo', 'menor_gana') returning id`,
      [workoutId, s.eventId],
    );

    if (conCategoria) {
      await s.db.query(
        "insert into part_divisions (part_id, division_id, event_id) values ($1, $2, $3)",
        [p.rows[0].id, s.divisionId, s.eventId],
      );
    }
  });
  return workoutId;
}

describe("la prueba de un heat", () => {
  it("con UNA sola prueba la toma sola: la carrera hibrida no elige nada", async () => {
    const circuito = await pruebaDelCircuito();

    await asUser(s.db, s.users.owner, async () => {
      // Asi lo inserta el fixture y asi lo inserta `createHeat` cuando el
      // evento tiene una sola prueba: sin pasarla.
      const res = await s.db.query<{ workout_id: string }>(
        `insert into heats (event_id, division_id, name, lane_count)
         values ($1, $2, 'Heat 9', 4) returning workout_id`,
        [s.eventId, s.divisionId],
      );
      expect(res.rows[0].workout_id).toBe(circuito);
    });
  });

  it("sin NINGUNA prueba se la crea: es el camino de un evento recien armado", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const otro = await s.db.query<{ id: string }>(
        `insert into events (org_id, name, public_slug, status)
         values ($1, 'Sin Pruebas', 'sin-pruebas', 'draft') returning id`,
        [s.orgId],
      );
      const eventId = otro.rows[0].id;

      const res = await s.db.query<{ workout_id: string }>(
        `insert into heats (event_id, name, lane_count)
         values ($1, 'Heat 1', 4) returning workout_id`,
        [eventId],
      );
      expect(res.rows[0].workout_id).not.toBeNull();

      const w = await s.db.query<{ name: string }>("select name from workouts where event_id = $1", [
        eventId,
      ]);
      expect(w.rows.map((r) => r.name)).toEqual(["Circuito"]);
    });
  });

  it("con VARIAS pruebas exige elegir en vez de agarrar la primera", async () => {
    await crearPrueba("WOD 2", 1);

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query(
          `insert into heats (event_id, division_id, name, lane_count)
           values ($1, $2, 'Heat 9', 4)`,
          [s.eventId, s.divisionId],
        ),
      );
      expect(msg).toContain("varias pruebas");
    });
  });

  it("con varias pruebas acepta la que se le pasa", async () => {
    const wod2 = await crearPrueba("WOD 2", 1);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ workout_id: string }>(
        `insert into heats (event_id, division_id, workout_id, name, lane_count)
         values ($1, $2, $3, 'Heat 9', 4) returning workout_id`,
        [s.eventId, s.divisionId, wod2],
      );
      expect(res.rows[0].workout_id).toBe(wod2);
    });
  });

  it("cada prueba numera desde 'Heat 1' sin chocar con la otra", async () => {
    const circuito = await pruebaDelCircuito();
    const wod2 = await crearPrueba("WOD 2", 1);

    await asUser(s.db, s.users.owner, async () => {
      // El fixture ya dejo un "Heat 1" del circuito en esta categoria.
      await s.db.query(
        `insert into heats (event_id, division_id, workout_id, name, lane_count)
         values ($1, $2, $3, 'Heat 1', 4)`,
        [s.eventId, s.divisionId, wod2],
      );

      const res = await s.db.query<{ workout_id: string }>(
        "select workout_id from heats where event_id = $1 and name = 'Heat 1'",
        [s.eventId],
      );
      expect(res.rows.map((r) => r.workout_id).sort()).toEqual([circuito, wod2].sort());
    });
  });

  it("dentro de la MISMA prueba y categoria el nombre sigue siendo unico", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query(
          `insert into heats (event_id, division_id, name, lane_count)
           values ($1, $2, 'Heat 1', 4)`,
          [s.eventId, s.divisionId],
        ),
      );
      expect(msg).toContain("heats_event_workout_division_name_key");
    });
  });
});

describe("auto_distribuir_heats con varias pruebas", () => {
  it("arma los heats de cada prueba y dice cual es cual", async () => {
    const circuito = await pruebaDelCircuito();
    const wod2 = await crearPrueba("WOD 2", 1);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{
        workout_id: string;
        workout_name: string;
        heats_creados: number;
        equipos_asignados: number;
      }>("select * from auto_distribuir_heats($1, 2)", [s.eventId]);

      // Una fila por (prueba, categoria): dos pruebas, una categoria.
      expect(res.rows).toHaveLength(2);
      expect(res.rows.map((r) => r.workout_id)).toEqual([circuito, wod2]);
      expect(res.rows.map((r) => r.workout_name)).toEqual(["Circuito", "WOD 2"]);
      expect(res.rows.every((r) => r.equipos_asignados === 3)).toBe(true);
      // 3 equipos en carriles de a 2 -> 2 heats por prueba.
      expect(res.rows.every((r) => r.heats_creados === 2)).toBe(true);
    });
  });

  it("acotada a una prueba, no toca las demas", async () => {
    const circuito = await pruebaDelCircuito();
    const wod2 = await crearPrueba("WOD 2", 1);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ workout_id: string }>(
        "select * from auto_distribuir_heats($1, 2, $2)",
        [s.eventId, wod2],
      );
      expect(res.rows.map((r) => r.workout_id)).toEqual([wod2]);

      // El unico heat del circuito sigue siendo el que armo el fixture.
      const delCircuito = await s.db.query<{ name: string }>(
        "select name from heats where event_id = $1 and workout_id = $2",
        [s.eventId, circuito],
      );
      expect(delCircuito.rows.map((r) => r.name)).toEqual(["Heat 1"]);
    });
  });

  it("una categoria que NO corre la prueba no recibe heats de ella", async () => {
    const wod3 = await crearPrueba("WOD 3", 1, false);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query("select * from auto_distribuir_heats($1, 2, $2)", [
        s.eventId,
        wod3,
      ]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("rechaza una prueba de otra competencia", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const otro = await s.db.query<{ id: string }>(
        `insert into events (org_id, name, public_slug, status)
         values ($1, 'Otra', 'otra-copa', 'draft') returning id`,
        [s.orgId],
      );
      const ajena = await s.db.query<{ id: string }>(
        "insert into workouts (event_id, order_index, name) values ($1, 0, 'Ajena') returning id",
        [otro.rows[0].id],
      );

      const msg = await expectDenied(() =>
        s.db.query("select * from auto_distribuir_heats($1, 2, $2)", [s.eventId, ajena.rows[0].id]),
      );
      expect(msg).toContain("no pertenece a esta competencia");
    });
  });

  /**
   * Los dos bugs que solo aparecen con mas de una prueba, en un solo caso
   * porque son la misma secuencia: distribuir todo, largar una prueba, y
   * volver a distribuir otra.
   */
  it("largada una prueba, la siguiente reparte a TODOS y no borra la anterior", async () => {
    const circuito = await pruebaDelCircuito();
    const wod2 = await crearPrueba("WOD 2", 1);

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select * from auto_distribuir_heats($1, 2)", [s.eventId]),
    );

    // Larga el primer heat del circuito. La distribucion ya le puso juez a
    // cada carril, que es lo que start_heat exige.
    let heatLargado = "";
    await asUser(s.db, s.users.owner, async () => {
      const h = await s.db.query<{ id: string }>(
        "select id from heats where event_id = $1 and workout_id = $2 order by name limit 1",
        [s.eventId, circuito],
      );
      heatLargado = h.rows[0].id;
      await s.db.query("select start_heat($1)", [heatLargado]);
    });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ equipos_asignados: number }>(
        "select * from auto_distribuir_heats($1, 2, $2)",
        [s.eventId, wod2],
      );

      // LOS TRES. Antes el filtro descartaba a quien ya tuviera carril en
      // CUALQUIER heat largado, asi que los 2 equipos del heat que acababa de
      // largar quedaban afuera del WOD 2 y solo entraba 1.
      expect(res.rows[0].equipos_asignados).toBe(3);

      // Y los heats del circuito siguen los dos: el borrado de "heats sin
      // largar" tampoco estaba acotado por prueba, asi que distribuir el WOD 2
      // se llevaba puesto el segundo heat del circuito.
      const delCircuito = await s.db.query<{ id: string }>(
        "select id from heats where event_id = $1 and workout_id = $2",
        [s.eventId, circuito],
      );
      expect(delCircuito.rows).toHaveLength(2);
    });
  });

  it("un equipo corre las dos pruebas, pero no dos veces la misma", async () => {
    const wod2 = await crearPrueba("WOD 2", 1);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select * from auto_distribuir_heats($1, 2)", [s.eventId]);

      const porEquipo = await s.db.query<{ n: string }>(
        "select count(*) as n from lanes where event_id = $1 and team_id = $2",
        [s.eventId, s.teamIds[0]],
      );
      expect(Number(porEquipo.rows[0].n)).toBe(2);

      // Un segundo carril del mismo equipo en la MISMA prueba sigue prohibido.
      const heat = await s.db.query<{ id: string }>(
        "select id from heats where event_id = $1 and workout_id = $2 order by name limit 1",
        [s.eventId, wod2],
      );
      const msg = await expectDenied(() =>
        s.db.query(
          "insert into lanes (heat_id, event_id, lane_number, team_id) values ($1, $2, 99, $3)",
          [heat.rows[0].id, s.eventId, s.teamIds[0]],
        ),
      );
      expect(msg).toContain("lanes_team_once_per_workout");
    });
  });
});
