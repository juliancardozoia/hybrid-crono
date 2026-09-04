/**
 * Import masivo y armado de heats.
 *
 * El punto de estos tests es la atomicidad: que un lote que falla no deje
 * medio padron cargado.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asUser, expectDenied } from "./harness";
import { asignarJueces, seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

function equipo(bib: number, miembros: Array<{ firstName: string; lastName: string }>) {
  return {
    divisionId: s.divisionId,
    bibNumber: bib,
    name: null,
    members: miembros.map((m) => ({ ...m, gender: "male", birthDate: null, email: null })),
  };
}

async function contarAtletas(): Promise<number> {
  let n = 0;
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ n: number }>(
      "select count(*)::int as n from athletes where event_id = $1",
      [s.eventId],
    );
    n = res.rows[0].n;
  });
  return n;
}

describe("import_teams", () => {
  it("carga equipos con sus atletas", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ bib_number: number }>(
        "select bib_number from import_teams($1, $2::jsonb)",
        [
          s.eventId,
          JSON.stringify([
            equipo(201, [{ firstName: "Ana", lastName: "Gomez" }]),
            equipo(202, [{ firstName: "Luis", lastName: "Perez" }]),
          ]),
        ],
      );
      expect(res.rows.map((r) => r.bib_number)).toEqual([201, 202]);
    });

    // El escenario ya traia 3 atletas.
    expect(await contarAtletas()).toBe(5);
  });

  it("vincula cada atleta con su equipo", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select import_teams($1, $2::jsonb)", [
        s.eventId,
        JSON.stringify([
          {
            divisionId: s.divisionId,
            bibNumber: 300,
            name: "Los Rapidos",
            members: [
              { firstName: "Ana", lastName: "Gomez", gender: "female", birthDate: "1990-01-02" },
              { firstName: "Luis", lastName: "Perez", gender: "male", birthDate: null },
            ],
          },
        ]),
      ]);

      const res = await s.db.query<{ n: number }>(
        `select count(*)::int as n from team_members tm
         join teams t on t.id = tm.team_id where t.bib_number = 300`,
      );
      expect(res.rows[0].n).toBe(2);
    });
  });

  it("guarda fecha y sexo con el tipo correcto", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select import_teams($1, $2::jsonb)", [
        s.eventId,
        JSON.stringify([
          {
            divisionId: s.divisionId,
            bibNumber: 301,
            members: [
              { firstName: "Ana", lastName: "Gomez", gender: "female", birthDate: "1990-01-02" },
            ],
          },
        ]),
      ]);

      const res = await s.db.query<{ gender: string; birth_date: string }>(
        "select gender, birth_date from athletes where first_name = 'Ana'",
      );
      expect(res.rows[0].gender).toBe("female");
      expect(String(res.rows[0].birth_date)).toContain("1990");
    });
  });

  // El caso que justifica que esto sea una funcion y no inserts sueltos.
  it("un dorsal repetido a mitad del lote no deja NADA cargado", async () => {
    const antes = await contarAtletas();

    await asUser(s.db, s.users.owner, async () => {
      await expectDenied(() =>
        s.db.query("select import_teams($1, $2::jsonb)", [
          s.eventId,
          JSON.stringify([
            equipo(401, [{ firstName: "Primero", lastName: "Ok" }]),
            equipo(402, [{ firstName: "Segundo", lastName: "Ok" }]),
            equipo(101, [{ firstName: "Tercero", lastName: "Choca" }]), // 101 ya existe
          ]),
        ]),
      );
    });

    expect(await contarAtletas()).toBe(antes);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query("select 1 from teams where bib_number in (401, 402)");
      expect(res.rows).toHaveLength(0);
    });
  });

  it("un juez no puede importar", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select import_teams($1, $2::jsonb)", [
          s.eventId,
          JSON.stringify([equipo(500, [{ firstName: "Ana", lastName: "Gomez" }])]),
        ]),
      );
      expect(msg).toContain("permiso");
    });
  });

  it("alguien ajeno al evento tampoco", async () => {
    await asUser(s.db, s.users.forastero, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select import_teams($1, $2::jsonb)", [
          s.eventId,
          JSON.stringify([equipo(501, [{ firstName: "Ana", lastName: "Gomez" }])]),
        ]),
      );
      expect(msg).toContain("permiso");
    });
  });
});

describe("un DNI o un correo no se repite DENTRO de la misma competencia", () => {
  it("el mismo documento en el mismo evento choca", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "insert into athletes (event_id, first_name, last_name, document_id) values ($1, 'Uno', 'Ok', '12345')",
        [s.eventId],
      );
      await expectDenied(() =>
        s.db.query(
          "insert into athletes (event_id, first_name, last_name, document_id) values ($1, 'Dos', 'Choca', '12345')",
          [s.eventId],
        ),
      );
    });
  });

  it("mayusculas y espacios no esquivan la regla", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "insert into athletes (event_id, first_name, last_name, document_id) values ($1, 'Uno', 'Ok', 'abc123')",
        [s.eventId],
      );
      await expectDenied(() =>
        s.db.query(
          "insert into athletes (event_id, first_name, last_name, document_id) values ($1, 'Dos', 'Choca', ' ABC123 ')",
          [s.eventId],
        ),
      );
    });
  });

  it("el mismo documento en OTRO evento no choca", async () => {
    const otro = await asUser(s.db, s.users.owner, async () => {
      const r = await s.db.query<{ id: string }>(
        "insert into events (org_id, name, public_slug) values ($1, 'Otro evento', 'otro-evento-doc') returning id",
        [s.orgId],
      );
      await s.db.query(
        "insert into athletes (event_id, first_name, last_name, document_id) values ($1, 'Uno', 'Ok', '999')",
        [s.eventId],
      );
      return r.rows[0].id;
    });

    await asUser(s.db, s.users.owner, async () => {
      // No debe lanzar.
      await s.db.query(
        "insert into athletes (event_id, first_name, last_name, document_id) values ($1, 'Otro', 'Atleta', '999')",
        [otro],
      );
    });
  });

  it("el mismo correo en el mismo evento choca", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "insert into athletes (event_id, first_name, last_name, email) values ($1, 'Uno', 'Ok', 'ana@correo.com')",
        [s.eventId],
      );
      await expectDenied(() =>
        s.db.query(
          "insert into athletes (event_id, first_name, last_name, email) values ($1, 'Dos', 'Choca', 'ANA@correo.com')",
          [s.eventId],
        ),
      );
    });
  });

  it("el mismo correo en OTRO evento no choca — la misma persona corre eventos de organizadores distintos", async () => {
    const otro = await asUser(s.db, s.users.owner, async () => {
      const r = await s.db.query<{ id: string }>(
        "insert into events (org_id, name, public_slug) values ($1, 'Otro evento', 'otro-evento-mail') returning id",
        [s.orgId],
      );
      await s.db.query(
        "insert into athletes (event_id, first_name, last_name, email) values ($1, 'Uno', 'Ok', 'ana@correo.com')",
        [s.eventId],
      );
      return r.rows[0].id;
    });

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "insert into athletes (event_id, first_name, last_name, email) values ($1, 'Ana', 'Otra vez', 'ana@correo.com')",
        [otro],
      );
    });
  });

  it("dos correos iguales en el MISMO lote de import_teams no dejan nada cargado", async () => {
    const antes = await contarAtletas();

    await asUser(s.db, s.users.owner, async () => {
      await expectDenied(() =>
        s.db.query("select import_teams($1, $2::jsonb)", [
          s.eventId,
          JSON.stringify([
            {
              divisionId: s.divisionId,
              bibNumber: 601,
              members: [
                { firstName: "Uno", lastName: "Ok", gender: "male", email: "dup@correo.com" },
              ],
            },
            {
              divisionId: s.divisionId,
              bibNumber: 602,
              members: [
                { firstName: "Dos", lastName: "Choca", gender: "male", email: "dup@correo.com" },
              ],
            },
          ]),
        ]),
      );
    });

    expect(await contarAtletas()).toBe(antes);
  });
});

describe("assign_heat_lanes", () => {
  it("arma los carriles en el orden recibido", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select assign_heat_lanes($1, $2::uuid[])", [
        s.heatId,
        [s.teamIds[2], s.teamIds[0], s.teamIds[1]],
      ]);

      const res = await s.db.query<{ lane_number: number; bib_number: number }>(
        `select l.lane_number, t.bib_number
         from lanes l join teams t on t.id = l.team_id
         where l.heat_id = $1 order by l.lane_number`,
        [s.heatId],
      );

      expect(res.rows.map((r) => r.bib_number)).toEqual([103, 101, 102]);
    });
  });

  it("rehacer la asignacion reemplaza la anterior", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select assign_heat_lanes($1, $2::uuid[])", [s.heatId, [s.teamIds[0]]]);
      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from lanes where heat_id = $1",
        [s.heatId],
      );
      expect(res.rows[0].n).toBe(1);
    });
  });

  it("no acepta mas equipos que carriles", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update heats set lane_count = 2 where id = $1", [s.heatId]);
      const msg = await expectDenied(() =>
        s.db.query("select assign_heat_lanes($1, $2::uuid[])", [s.heatId, s.teamIds]),
      );
      expect(msg).toContain("2 carriles");
    });
  });

  // Reasignar en caliente dejaria marcajes apuntando a un equipo que ya no esta.
  it("no se pueden reasignar los carriles de un heat que ya largo", async () => {
    await asignarJueces(s);
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select start_heat($1)", [s.heatId]);
      const msg = await expectDenied(() =>
        s.db.query("select assign_heat_lanes($1, $2::uuid[])", [s.heatId, [s.teamIds[0]]]),
      );
      expect(msg).toContain("reasignar");
    });
  });

  it("un juez no puede armar heats", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select assign_heat_lanes($1, $2::uuid[])", [s.heatId, [s.teamIds[0]]]),
      );
      expect(msg).toContain("permiso");
    });
  });
});

describe("assign_heat_lanes conserva el numero de carril", () => {
  // El bug: el cliente compactaba el arreglo y un equipo puesto en el carril 3
  // terminaba corriendo en el 1. En un heat de seis, eso es tomarle el tiempo al
  // atleta equivocado.
  it("un hueco al principio no corre a los demas", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select assign_heat_lanes($1, $2::uuid[])", [
        s.heatId,
        [null, null, s.teamIds[0]],
      ]);

      const res = await s.db.query<{ lane_number: number; bib_number: number }>(
        `select l.lane_number, t.bib_number
         from lanes l join teams t on t.id = l.team_id
         where l.heat_id = $1 order by l.lane_number`,
        [s.heatId],
      );

      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].lane_number).toBe(3);
    });
  });

  it("los huecos del medio tampoco", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select assign_heat_lanes($1, $2::uuid[])", [
        s.heatId,
        [s.teamIds[0], null, s.teamIds[1]],
      ]);

      const res = await s.db.query<{ lane_number: number; bib_number: number }>(
        `select l.lane_number, t.bib_number
         from lanes l join teams t on t.id = l.team_id
         where l.heat_id = $1 order by l.lane_number`,
        [s.heatId],
      );

      expect(res.rows.map((r) => [r.lane_number, r.bib_number])).toEqual([
        [1, 101],
        [3, 102],
      ]);
    });
  });

  it("no deja guardar un heat sin ningun equipo", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select assign_heat_lanes($1, $2::uuid[])", [s.heatId, [null, null]]),
      );
      expect(msg).toContain("ningun equipo");
    });
  });
});
