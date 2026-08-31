/**
 * Perfiles: sincronizacion desde auth.users y quien puede ver a quien.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { asAdmin, asUser, createTestDb, createUser, type TestDb } from "./harness";

let db: TestDb;
let ana: string;
let beto: string;
let carla: string;

beforeAll(async () => {
  db = await createTestDb();

  ana = await createUser(db, "ana@boxnorte.com", "Ana Gomez");
  beto = await createUser(db, "beto@boxnorte.com", "Beto Perez");
  carla = await createUser(db, "carla@boxsur.com", "Carla Diaz");

  await asUser(db, ana, async () => {
    const org = await db.query<{ id: string }>(
      "insert into organizations (name, slug, created_by) values ('Box Norte', 'box-norte', $1) returning id",
      [ana],
    );
    await db.query("insert into org_members (org_id, user_id, role) values ($1, $2, 'judge')", [
      org.rows[0].id,
      beto,
    ]);
  });

  await asUser(db, carla, () =>
    db.query("insert into organizations (name, slug, created_by) values ('Box Sur', 'box-sur', $1)", [
      carla,
    ]),
  );
});

describe("sincronizacion", () => {
  it("crear un usuario crea su perfil", async () => {
    await asAdmin(db, async () => {
      const res = await db.query<{ email: string; full_name: string }>(
        "select email, full_name from profiles where id = $1",
        [ana],
      );
      expect(res.rows[0]).toEqual({ email: "ana@boxnorte.com", full_name: "Ana Gomez" });
    });
  });

  it("un usuario sin nombre en el metadata queda con full_name nulo", async () => {
    const sinNombre = await createUser(db, "sin.nombre@boxnorte.com");
    await asAdmin(db, async () => {
      const res = await db.query<{ full_name: string | null }>(
        "select full_name from profiles where id = $1",
        [sinNombre],
      );
      expect(res.rows[0].full_name).toBeNull();
    });
  });

  it("cambiar el email en auth lo refleja en el perfil", async () => {
    await asAdmin(db, async () => {
      await db.query("update auth.users set email = 'nuevo@boxnorte.com' where id = $1", [beto]);
      const res = await db.query<{ email: string }>("select email from profiles where id = $1", [
        beto,
      ]);
      expect(res.rows[0].email).toBe("nuevo@boxnorte.com");
    });
  });
});

describe("visibilidad", () => {
  it("veo mi propio perfil", async () => {
    await asUser(db, ana, async () => {
      const res = await db.query("select id from profiles where id = $1", [ana]);
      expect(res.rows).toHaveLength(1);
    });
  });

  it("veo a quien comparte organizacion conmigo", async () => {
    await asUser(db, ana, async () => {
      const res = await db.query("select id from profiles where id = $1", [beto]);
      expect(res.rows).toHaveLength(1);
    });
  });

  it("NO veo el perfil de alguien de otra organizacion", async () => {
    await asUser(db, ana, async () => {
      const res = await db.query("select id from profiles where id = $1", [carla]);
      expect(res.rows).toHaveLength(0);
    });
  });

  it("no puedo editar el perfil de otro", async () => {
    await asUser(db, ana, async () => {
      const res = await db.query("update profiles set full_name = 'Hackeado' where id = $1", [
        beto,
      ]);
      expect(res.affectedRows).toBe(0);
    });
  });

  it("puedo editar el mio", async () => {
    await asUser(db, ana, async () => {
      const res = await db.query("update profiles set full_name = 'Ana G.' where id = $1", [ana]);
      expect(res.affectedRows).toBe(1);
    });
  });
});
