/**
 * Configuracion de la competencia: reordenamiento del circuito y validaciones
 * que el organizador consulta antes de dar por lista una competencia.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let templateId: string;

beforeEach(async () => {
  s = await seedScenario();
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ course_template_id: string }>(
      "select course_template_id from divisions where id = $1",
      [s.divisionId],
    );
    templateId = res.rows[0].course_template_id;
  });
});

async function ordenActual(): Promise<string[]> {
  let nombres: string[] = [];
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ name: string }>(
      "select name from segments where course_template_id = $1 order by order_index",
      [templateId],
    );
    nombres = res.rows.map((r) => r.name);
  });
  return nombres;
}

describe("reorder_segments", () => {
  it("el circuito arranca en el orden en que se cargo", async () => {
    expect(await ordenActual()).toEqual([
      "500m Run",
      "SkiErg 500m",
      "500m Run",
      "Wall Balls 50",
    ]);
  });

  it("invierte el orden sin chocar con el unique de order_index", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select reorder_segments($1, $2::uuid[])", [
        templateId,
        [...s.segmentIds].reverse(),
      ]);
    });

    expect(await ordenActual()).toEqual([
      "Wall Balls 50",
      "500m Run",
      "SkiErg 500m",
      "500m Run",
    ]);
  });

  it("mover uno al principio no rompe nada", async () => {
    const [a, b, c, d] = s.segmentIds;
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select reorder_segments($1, $2::uuid[])", [templateId, [d, a, b, c]]);
    });

    expect(await ordenActual()).toEqual([
      "Wall Balls 50",
      "500m Run",
      "SkiErg 500m",
      "500m Run",
    ]);
  });

  it("los indices quedan consecutivos desde cero", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select reorder_segments($1, $2::uuid[])", [
        templateId,
        [...s.segmentIds].reverse(),
      ]);
      const res = await s.db.query<{ order_index: number }>(
        "select order_index from segments where course_template_id = $1 order by order_index",
        [templateId],
      );
      expect(res.rows.map((r) => r.order_index)).toEqual([0, 1, 2, 3]);
    });
  });

  it("rechaza una lista incompleta en vez de aplicarla a medias", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select reorder_segments($1, $2::uuid[])", [
          templateId,
          s.segmentIds.slice(0, 2),
        ]),
      );
      expect(msg).toContain("2 segmentos");
    });

    // Y el circuito quedo como estaba.
    expect(await ordenActual()).toEqual([
      "500m Run",
      "SkiErg 500m",
      "500m Run",
      "Wall Balls 50",
    ]);
  });

  it("un juez no puede reordenar el circuito", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select reorder_segments($1, $2::uuid[])", [templateId, s.segmentIds]),
      );
      expect(msg).toContain("permiso");
    });
  });

  it("alguien ajeno al evento tampoco", async () => {
    await asUser(s.db, s.users.forastero, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select reorder_segments($1, $2::uuid[])", [templateId, s.segmentIds]),
      );
      expect(msg).toContain("permiso");
    });
  });
});

describe("event_config_issues", () => {
  async function issues(): Promise<Array<{ severity: string; code: string }>> {
    let filas: Array<{ severity: string; code: string }> = [];
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ severity: string; code: string }>(
        "select severity, code from event_config_issues($1)",
        [s.eventId],
      );
      filas = res.rows;
    });
    return filas;
  }

  it("el escenario sembrado esta limpio", async () => {
    expect(await issues()).toEqual([]);
  });

  it("detecta un equipo con menos integrantes de los que pide su division", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("delete from team_members where team_id = $1", [s.teamIds[0]]),
    );

    const codigos = (await issues()).map((i) => i.code);
    expect(codigos).toContain("equipo_incompleto");
  });

  it("detecta a alguien que no corresponde a una division de un solo sexo", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        `update athletes set gender = 'female'
         where id = (select athlete_id from team_members where team_id = $1 limit 1)`,
        [s.teamIds[0]],
      ),
    );

    const codigos = (await issues()).map((i) => i.code);
    expect(codigos).toContain("sexo_no_corresponde");
  });

  it("avisa de una division sin inscriptos, como warning y no como error", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Individual Femenino', 1, 'female', $2)`,
        [s.eventId, templateId],
      ),
    );

    const encontrados = await issues();
    const vacia = encontrados.find((i) => i.code === "division_vacia");
    expect(vacia?.severity).toBe("warning");
  });

  it("avisa si falta la fecha de nacimiento en una division con rango de edad", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update divisions set age_min = 40 where id = $1", [s.divisionId]),
    );

    const codigos = (await issues()).map((i) => i.code);
    expect(codigos).toContain("edad_desconocida");
  });

  it("un equipo retirado no cuenta como problema", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("delete from team_members where team_id = $1", [s.teamIds[0]]);
      await s.db.query("update teams set status = 'withdrawn' where id = $1", [s.teamIds[0]]);
    });

    const codigos = (await issues()).map((i) => i.code);
    expect(codigos).not.toContain("equipo_incompleto");
  });
});
