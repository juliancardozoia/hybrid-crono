/**
 * `segments.es_tiebreak` y `marcar_segmento_de_desempate`: el circuito de una
 * carrera hibrida gana la capacidad de declarar un segmento de desempate.
 *
 * Lo que se prueba en Postgres: el permiso, que un segundo segmento marcado
 * de la MISMA plantilla apaga al primero (el indice unico parcial lo
 * garantiza incluso contra un update directo), que marcar/desmarcar
 * sincroniza los `tiebreak_*` de la parte de circuito, y sobre todo el
 * AISLAMIENTO entre dos circuitos independientes del mismo evento -- que es
 * la garantia que motivo separar esto en el segmento y no en la parte.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAnon, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

/** La parte de circuito que el evento del fixture ya tiene (una sola). */
async function parteDeCircuito(): Promise<string> {
  const r = await asUser(s.db, s.users.owner, () =>
    s.db.query<{ id: string }>(
      "select id from workout_parts where event_id = $1 and time_scheme = 'circuito'",
      [s.eventId],
    ),
  );
  return r.rows[0].id;
}

async function estadoDeLaParte(
  partId: string,
): Promise<{ tiebreak_source: string | null; tiebreak_unit: string | null; tiebreak_dir: string | null }> {
  const r = await asUser(s.db, s.users.owner, () =>
    s.db.query<{ tiebreak_source: string | null; tiebreak_unit: string | null; tiebreak_dir: string | null }>(
      "select tiebreak_source, tiebreak_unit, tiebreak_dir from workout_parts where id = $1",
      [partId],
    ),
  );
  return r.rows[0];
}

describe("marcar_segmento_de_desempate", () => {
  it("exige permiso de gestion", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select marcar_segmento_de_desempate($1, true)", [s.segmentIds[1]]),
      );
      expect(msg).toContain("No tienes permiso");
    });
  });

  it("el anonimo no puede invocarla: no hay GRANT, no es un tema de RLS", async () => {
    // A diferencia de RLS (que devuelve cero filas sin error), la ausencia de
    // GRANT de EXECUTE es lo que frena a `anon` -- ver "Dos barreras
    // distintas" en CLAUDE.md. Esto ya lo cubre scripts/verify-security.mjs
    // contra la base real, pero ese script exige un proyecto Supabase vivo y
    // no corre con `npm test`: esta es la unica red que lo atrapa en CI.
    await expectDenied(() =>
      asAnon(s.db, () => s.db.query("select marcar_segmento_de_desempate($1, true)", [s.segmentIds[1]])),
    );
  });

  it("marcar un segmento sincroniza la parte de circuito a 'hito'/'tiempo'/'menor_gana'", async () => {
    const partId = await parteDeCircuito();
    expect(await estadoDeLaParte(partId)).toEqual({
      tiebreak_source: null,
      tiebreak_unit: null,
      tiebreak_dir: null,
    });

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select marcar_segmento_de_desempate($1, true)", [s.segmentIds[1]]),
    );

    expect(await estadoDeLaParte(partId)).toEqual({
      tiebreak_source: "hito",
      tiebreak_unit: "tiempo",
      tiebreak_dir: "menor_gana",
    });
  });

  it("desmarcar el ultimo segmento vuelve la parte a null en los cuatro campos", async () => {
    const partId = await parteDeCircuito();
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select marcar_segmento_de_desempate($1, true)", [s.segmentIds[1]]);
      await s.db.query("select marcar_segmento_de_desempate($1, false)", [s.segmentIds[1]]);
    });

    expect(await estadoDeLaParte(partId)).toEqual({
      tiebreak_source: null,
      tiebreak_unit: null,
      tiebreak_dir: null,
    });
  });

  it("marcar un segundo segmento de la MISMA plantilla apaga el primero", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select marcar_segmento_de_desempate($1, true)", [s.segmentIds[0]]);
      await s.db.query("select marcar_segmento_de_desempate($1, true)", [s.segmentIds[1]]);

      const marcados = await s.db.query<{ id: string }>(
        "select id from segments where id = any($1) and es_tiebreak",
        [s.segmentIds],
      );
      expect(marcados.rows.map((r) => r.id)).toEqual([s.segmentIds[1]]);
    });
  });

  it("un insert/update directo con dos segmentos marcados en la misma plantilla lo rechaza el indice unico parcial", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update segments set es_tiebreak = true where id = $1", [s.segmentIds[0]]);

      let fallo = false;
      try {
        await s.db.query("update segments set es_tiebreak = true where id = $1", [s.segmentIds[1]]);
      } catch {
        fallo = true;
      }
      expect(fallo).toBe(true);
    });
  });
});

describe("aislamiento entre dos circuitos independientes del mismo evento", () => {
  it("dos plantillas de circuito en PARTES distintas no se interfieren nunca", async () => {
    // Escenario mas claro del aislamiento: dos WODs de circuito distintos
    // (dos partes), cada uno con su propia plantilla y division.
    const { partId2, segmentId2 } = await asUser(s.db, s.users.owner, async () => {
      const workout2 = await s.db.query<{ id: string }>(
        "insert into workouts (event_id, name, order_index) values ($1, 'Circuito 2', 1) returning id",
        [s.eventId],
      );
      const parte2 = await s.db.query<{ id: string }>(
        `insert into workout_parts (workout_id, event_id, order_index, time_scheme, score_unit, score_dir)
         values ($1, $2, 0, 'circuito', 'tiempo', 'menor_gana') returning id`,
        [workout2.rows[0].id, s.eventId],
      );

      const template2 = await s.db.query<{ id: string }>(
        "insert into course_templates (event_id, name) values ($1, 'Circuito T2') returning id",
        [s.eventId],
      );

      const segmento2 = await s.db.query<{ id: string }>(
        `insert into segments (course_template_id, event_id, order_index, kind, name)
         values ($1, $2, 0, 'station', 'Estacion T2') returning id`,
        [template2.rows[0].id, s.eventId],
      );

      const division2 = await s.db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Individual Femenino Scaled', 1, 'female', $2) returning id`,
        [s.eventId, template2.rows[0].id],
      );

      await s.db.query(
        "insert into part_divisions (part_id, division_id, event_id, course_template_id) values ($1, $2, $3, $4)",
        [parte2.rows[0].id, division2.rows[0].id, s.eventId, template2.rows[0].id],
      );

      return { partId2: parte2.rows[0].id, segmentId2: segmento2.rows[0].id };
    });

    const partId1 = await parteDeCircuito();
    expect(partId1).not.toBe(partId2);

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select marcar_segmento_de_desempate($1, true)", [s.segmentIds[1]]),
    );

    expect(await estadoDeLaParte(partId1)).toEqual({
      tiebreak_source: "hito",
      tiebreak_unit: "tiempo",
      tiebreak_dir: "menor_gana",
    });
    // La parte del OTRO circuito no se toco.
    expect(await estadoDeLaParte(partId2)).toEqual({
      tiebreak_source: null,
      tiebreak_unit: null,
      tiebreak_dir: null,
    });

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select marcar_segmento_de_desempate($1, true)", [segmentId2]),
    );

    // Marcar T2 no apago el de T1.
    const t1SigueMarcado = await asUser(s.db, s.users.owner, () =>
      s.db.query<{ es_tiebreak: boolean }>("select es_tiebreak from segments where id = $1", [
        s.segmentIds[1],
      ]),
    );
    expect(t1SigueMarcado.rows[0].es_tiebreak).toBe(true);
    expect(await estadoDeLaParte(partId1)).toEqual({
      tiebreak_source: "hito",
      tiebreak_unit: "tiempo",
      tiebreak_dir: "menor_gana",
    });
    expect(await estadoDeLaParte(partId2)).toEqual({
      tiebreak_source: "hito",
      tiebreak_unit: "tiempo",
      tiebreak_dir: "menor_gana",
    });
  });
});
