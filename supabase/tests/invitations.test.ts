/**
 * Invitaciones a una organizacion.
 *
 * El caso que motiva todo: un juez voluntario llega el dia del evento, se
 * registra, y tiene que ver sus carriles — no una pantalla ofreciendole crear
 * su propia organizacion.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

async function invitar(quien: string, email: string, rol = "judge") {
  return asUser(s.db, quien, () =>
    s.db.query<{ estado: string; detalle: string }>(
      "select estado, detalle from invite_to_org($1, $2, $3::org_role)",
      [s.orgId, email, rol],
    ),
  );
}

async function esMiembro(userId: string): Promise<string | null> {
  let rol: string | null = null;
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ role: string }>(
      "select role from org_members where org_id = $1 and user_id = $2",
      [s.orgId, userId],
    );
    rol = res.rows[0]?.role ?? null;
  });
  return rol;
}

describe("invitar a alguien que ya tiene cuenta", () => {
  it("lo agrega directo", async () => {
    const nuevo = await createUser(s.db, "nuevo.juez@box.com");
    const res = await invitar(s.users.owner, "nuevo.juez@box.com");

    expect(res.rows[0].estado).toBe("agregado");
    expect(await esMiembro(nuevo)).toBe("judge");
  });

  it("no importa como este escrito el email", async () => {
    const nuevo = await createUser(s.db, "juez.mayus@box.com");
    await invitar(s.users.owner, "  Juez.Mayus@BOX.com  ");
    expect(await esMiembro(nuevo)).toBe("judge");
  });

  it("invitar de nuevo con otro rol actualiza el rol", async () => {
    const nuevo = await createUser(s.db, "asciende@box.com");
    await invitar(s.users.owner, "asciende@box.com", "judge");
    await invitar(s.users.owner, "asciende@box.com", "head_judge");
    expect(await esMiembro(nuevo)).toBe("head_judge");
  });
});

describe("invitar a alguien que todavia no se registro", () => {
  it("deja la invitacion pendiente", async () => {
    const res = await invitar(s.users.owner, "futuro.juez@box.com");
    expect(res.rows[0].estado).toBe("invitado");
  });

  // El caso real: se invita a los jueces la noche antes y se registran el dia
  // del evento.
  it("al registrarse queda dentro de la organizacion sola", async () => {
    await invitar(s.users.owner, "futuro.juez@box.com", "head_judge");

    const usuario = await createUser(s.db, "futuro.juez@box.com");

    expect(await esMiembro(usuario)).toBe("head_judge");
  });

  it("la invitacion queda marcada como aceptada", async () => {
    await invitar(s.users.owner, "futuro.juez@box.com");
    await createUser(s.db, "futuro.juez@box.com");

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ accepted_at: string | null }>(
        "select accepted_at from org_invitations where email = $1",
        ["futuro.juez@box.com"],
      );
      expect(res.rows[0].accepted_at).not.toBeNull();
    });
  });

  it("quien se registra sin invitacion no entra a ninguna organizacion", async () => {
    const suelto = await createUser(s.db, "nadie.lo.invito@box.com");
    expect(await esMiembro(suelto)).toBeNull();
  });
});

describe("permisos", () => {
  it("un juez no puede invitar", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select invite_to_org($1, $2, 'judge'::org_role)", [s.orgId, "x@y.com"]),
      );
      expect(msg).toContain("administrador");
    });
  });

  it("el head judge tampoco", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      await expectDenied(() =>
        s.db.query("select invite_to_org($1, $2, 'judge'::org_role)", [s.orgId, "x@y.com"]),
      );
    });
  });

  it("un admin no puede nombrar a otro dueno", async () => {
    const admin = await createUser(s.db, "admin@box.com");
    await asUser(s.db, s.users.owner, () =>
      s.db.query("insert into org_members (org_id, user_id, role) values ($1, $2, 'admin')", [
        s.orgId,
        admin,
      ]),
    );

    await asUser(s.db, admin, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select invite_to_org($1, $2, 'owner'::org_role)", [s.orgId, "x@y.com"]),
      );
      expect(msg).toContain("nombrar a otro");
    });
  });

  it("alguien ajeno no puede invitar a una organizacion que no es suya", async () => {
    await asUser(s.db, s.users.forastero, async () => {
      await expectDenied(() =>
        s.db.query("select invite_to_org($1, $2, 'judge'::org_role)", [s.orgId, "x@y.com"]),
      );
    });
  });

  it("un juez no ve las invitaciones pendientes", async () => {
    await invitar(s.users.owner, "futuro@box.com");
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query("select * from org_invitations");
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe("remove_org_member", () => {
  it("el dueno puede quitar a un juez", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select remove_org_member($1, $2)", [s.orgId, s.users.judgeA]),
    );
    expect(await esMiembro(s.users.judgeA)).toBeNull();
  });

  // Una organizacion sin dueno queda sin nadie que pueda administrarla.
  it("no se puede quitar al unico dueno", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select remove_org_member($1, $2)", [s.orgId, s.users.owner]),
      );
      expect(msg).toContain("nombra a otro");
    });
  });

  it("un juez no puede quitar a nadie", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      await expectDenied(() =>
        s.db.query("select remove_org_member($1, $2)", [s.orgId, s.users.judgeB]),
      );
    });
  });
});
