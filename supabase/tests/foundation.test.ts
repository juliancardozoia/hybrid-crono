/**
 * Aislamiento multi-tenant.
 *
 * Lo que se prueba aca no es que el SQL corra, sino que un organizador NO pueda
 * ver ni tocar los datos de otra organizacion. Es la clase de bug que no se nota
 * hasta que dos clientes comparten la plataforma, y para entonces ya es tarde.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { asAdmin, asUser, createTestDb, createUser, expectDenied, type TestDb } from "./harness";

let db: TestDb;
let ana: string; // owner de Box Norte
let beto: string; // juez de Box Norte
let carla: string; // owner de Box Sur, ajena a Box Norte
let boxNorte: string;
let eventoNorte: string;

beforeAll(async () => {
  db = await createTestDb();

  ana = await createUser(db, "ana@boxnorte.com");
  beto = await createUser(db, "beto@boxnorte.com");
  carla = await createUser(db, "carla@boxsur.com");

  await asUser(db, ana, async () => {
    const org = await db.query<{ id: string }>(
      "insert into organizations (name, slug, created_by) values ($1, $2, $3) returning id",
      ["Box Norte", "box-norte", ana],
    );
    boxNorte = org.rows[0].id;

    const evt = await db.query<{ id: string }>(
      "insert into events (org_id, name, public_slug) values ($1, $2, $3) returning id",
      [boxNorte, "Hybrid Games 2026", "hybrid-games-2026"],
    );
    eventoNorte = evt.rows[0].id;

    await db.query("insert into org_members (org_id, user_id, role) values ($1, $2, 'judge')", [
      boxNorte,
      beto,
    ]);
  });

  await asUser(db, carla, async () => {
    await db.query(
      "insert into organizations (name, slug, created_by) values ($1, $2, $3) returning id",
      ["Box Sur", "box-sur", carla],
    );
  });
});

describe("creacion de organizacion", () => {
  it("el creador queda como owner automaticamente", async () => {
    await asUser(db, ana, async () => {
      const res = await db.query<{ role: string }>(
        "select role from org_members where org_id = $1 and user_id = $2",
        [boxNorte, ana],
      );
      expect(res.rows[0]?.role).toBe("owner");
    });
  });

  it("el creador puede leer lo que acaba de crear", async () => {
    await asUser(db, ana, async () => {
      const res = await db.query("select id from organizations where id = $1", [boxNorte]);
      expect(res.rows).toHaveLength(1);
    });
  });
});

describe("aislamiento entre organizaciones", () => {
  it("carla no ve la organizacion de ana", async () => {
    await asUser(db, carla, async () => {
      const res = await db.query("select id from organizations where id = $1", [boxNorte]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("carla no ve el evento de ana", async () => {
    await asUser(db, carla, async () => {
      const res = await db.query("select id from events where id = $1", [eventoNorte]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("carla no ve el padron de ana", async () => {
    await asUser(db, carla, async () => {
      const res = await db.query("select user_id from org_members where org_id = $1", [boxNorte]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("carla no puede crear eventos en la organizacion de ana", async () => {
    await asUser(db, carla, async () => {
      await expectDenied(() =>
        db.query("insert into events (org_id, name, public_slug) values ($1, $2, $3)", [
          boxNorte,
          "Evento pirata",
          "evento-pirata",
        ]),
      );
    });
  });

  it("carla no puede renombrar el evento de ana", async () => {
    await asUser(db, carla, async () => {
      const res = await db.query("update events set name = 'Hackeado' where id = $1", [
        eventoNorte,
      ]);
      // RLS no lanza error en un update que no matchea: simplemente no afecta filas.
      expect(res.affectedRows).toBe(0);
    });
  });

  it("el evento de ana sigue intacto", async () => {
    await asAdmin(db, async () => {
      const res = await db.query<{ name: string }>("select name from events where id = $1", [
        eventoNorte,
      ]);
      expect(res.rows[0].name).toBe("Hybrid Games 2026");
    });
  });
});

describe("roles dentro de la organizacion", () => {
  it("el juez ve el evento de su organizacion", async () => {
    await asUser(db, beto, async () => {
      const res = await db.query("select id from events where id = $1", [eventoNorte]);
      expect(res.rows).toHaveLength(1);
    });
  });

  it("el juez NO puede cambiar la configuracion del evento", async () => {
    await asUser(db, beto, async () => {
      const res = await db.query("update events set name = 'Cambiado por el juez' where id = $1", [
        eventoNorte,
      ]);
      expect(res.affectedRows).toBe(0);
    });
  });

  it("el juez no puede ascenderse a admin", async () => {
    await asUser(db, beto, async () => {
      const res = await db.query(
        "update org_members set role = 'admin' where org_id = $1 and user_id = $2",
        [boxNorte, beto],
      );
      expect(res.affectedRows).toBe(0);
    });
  });

  it("los helpers de autorizacion reportan el rol correcto", async () => {
    await asUser(db, beto, async () => {
      const res = await db.query<{ rol: string; gestiona: boolean; verifica: boolean }>(
        "select event_role($1) as rol, can_manage_event($1) as gestiona, can_verify_event($1) as verifica",
        [eventoNorte],
      );
      expect(res.rows[0]).toEqual({ rol: "judge", gestiona: false, verifica: false });
    });

    await asUser(db, ana, async () => {
      const res = await db.query<{ rol: string; gestiona: boolean; verifica: boolean }>(
        "select event_role($1) as rol, can_manage_event($1) as gestiona, can_verify_event($1) as verifica",
        [eventoNorte],
      );
      expect(res.rows[0]).toEqual({ rol: "owner", gestiona: true, verifica: true });
    });
  });
});

describe("sesion sin usuario", () => {
  it("un anonimo no ve nada", async () => {
    await asUser(db, null, async () => {
      const res = await db.query("select id from events");
      expect(res.rows).toHaveLength(0);
    });
  });
});
