/**
 * Postulacion publica de jueces, aprobacion, autoasignacion configurable y un
 * juez en un solo carril activo a la vez.
 *
 * El requisito del producto: la invitacion del organizador se aprueba sola
 * (el organizador ya eligio a esa persona), pero una postulacion publica NO
 * tiene acceso a nada hasta que alguien la revisa. Y un juez no puede estar
 * en dos heats al mismo tiempo: tiene que terminar uno para tomar otro.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, createUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let postulante: string;

beforeEach(async () => {
  s = await seedScenario();
  postulante = await createUser(s.db, "postulante@fuera.com", "Postulante Ajeno");

  // apply_as_judge exige que el evento este PUBLICADO.
  await asAdmin(s.db, () =>
    s.db.query("update events set published_at = now() where id = $1", [s.eventId]),
  );
});

// apply_as_judge recibe el SLUG publico del evento, no su id: es lo que llama
// la ficha publica, y esa pagina nunca tuvo el uuid interno en su payload.
describe("apply_as_judge", () => {
  async function slug(): Promise<string> {
    return asAdmin(s.db, async () => {
      const res = await s.db.query<{ public_slug: string }>(
        "select public_slug from events where id = $1",
        [s.eventId],
      );
      return res.rows[0].public_slug;
    });
  }

  it("crea la postulacion sin aprobar", async () => {
    const publicSlug = await slug();
    await asUser(s.db, postulante, async () => {
      const res = await s.db.query<{ approved_at: string | null; role: string }>(
        "select approved_at, role from apply_as_judge($1)",
        [publicSlug],
      );
      expect(res.rows[0].approved_at).toBeNull();
      expect(res.rows[0].role).toBe("judge");
    });
  });

  it("exige estar logueado", async () => {
    const publicSlug = await slug();
    await asAnon(s.db, async () => {
      await expectDenied(() => s.db.query("select apply_as_judge($1)", [publicSlug]));
    });
  });

  it("rechaza un evento no publicado", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set published_at = null where id = $1", [s.eventId]),
    );
    const publicSlug = await slug();
    await asUser(s.db, postulante, async () => {
      const msg = await expectDenied(() => s.db.query("select apply_as_judge($1)", [publicSlug]));
      expect(msg).toContain("no recibe postulaciones");
    });
  });

  it("no se puede postular dos veces", async () => {
    const publicSlug = await slug();
    await asUser(s.db, postulante, async () => {
      await s.db.query("select apply_as_judge($1)", [publicSlug]);
      const msg = await expectDenied(() => s.db.query("select apply_as_judge($1)", [publicSlug]));
      expect(msg).toContain("Ya estás postulado");
    });
  });

  it("sin aprobar, no tiene event_role ni puede tomar carril", async () => {
    const publicSlug = await slug();
    await asUser(s.db, postulante, async () => {
      await s.db.query("select apply_as_judge($1)", [publicSlug]);

      const rol = await s.db.query<{ event_role: string | null }>("select event_role($1)", [
        s.eventId,
      ]);
      expect(rol.rows[0].event_role).toBeNull();

      const msg = await expectDenied(() =>
        s.db.query("select claim_lane($1)", [s.laneIds[0]]),
      );
      expect(msg).toContain("postulación todavía no fue aprobada");
    });
  });
});

describe("approve_event_staff", () => {
  async function postularse(): Promise<string> {
    const publicSlug = await asAdmin(s.db, async () => {
      const res = await s.db.query<{ public_slug: string }>(
        "select public_slug from events where id = $1",
        [s.eventId],
      );
      return res.rows[0].public_slug;
    });

    return asUser(s.db, postulante, async () => {
      const res = await s.db.query<{ id: string }>("select id from apply_as_judge($1)", [
        publicSlug,
      ]);
      return res.rows[0].id;
    });
  }

  // event_role() NO se pone en 'judge' aprobado el juez: un juez de evento no
  // tiene por que ver la competencia (ver jueces-alcance-acotado.test.ts).
  // Lo que SI cambia con la aprobacion es event_staff_role() -- de la que
  // depende claim_lane() -- y eso es lo que se verifica aca.
  it("la organización aprueba y el juez pasa a poder tomar carril", async () => {
    const staffId = await postularse();

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select approve_event_staff($1)", [staffId]),
    );

    await asUser(s.db, postulante, async () => {
      const rol = await s.db.query<{ event_role: string | null; rol_staff: string }>(
        "select event_role($1) as event_role, event_staff_role($1) as rol_staff",
        [s.eventId],
      );
      expect(rol.rows[0].event_role).toBeNull();
      expect(rol.rows[0].rol_staff).toBe("judge");

      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        s.laneIds[0],
      ]);
      expect(res.rows[0].judge_id).toBe(postulante);
    });
  });

  it("un juez comun no puede aprobar postulaciones", async () => {
    const staffId = await postularse();
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select approve_event_staff($1)", [staffId]),
      );
      expect(msg).toContain("Solo la organización");
    });
  });
});

describe("invite_event_staff sigue aprobando solo", () => {
  it("un colaborador invitado por la organización queda aprobado de una", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ approved_at: string | null }>(
        `select approved_at from invite_event_staff($1, 'nuevo@box.com', 'judge')`,
        [s.eventId],
      );
      expect(res.rows[0].approved_at).not.toBeNull();
    });
  });
});

describe("claim_lane: un juez, un heat a la vez", () => {
  let heat2Id: string;
  let lane2Id: string;

  beforeEach(async () => {
    await asAdmin(s.db, async () => {
      const heat = await s.db.query<{ id: string }>(
        "insert into heats (event_id, division_id, name, lane_count) values ($1, $2, 'Heat 2', 1) returning id",
        [s.eventId, s.divisionId],
      );
      heat2Id = heat.rows[0].id;

      const lane = await s.db.query<{ id: string }>(
        "insert into lanes (heat_id, event_id, lane_number) values ($1, $2, 1) returning id",
        [heat2Id, s.eventId],
      );
      lane2Id = lane.rows[0].id;
    });
  });

  it("cubrir dos carriles del MISMO heat esta permitido", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select claim_lane($1)", [s.laneIds[0]]);
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        s.laneIds[1],
      ]);
      expect(res.rows[0].judge_id).toBe(s.users.judgeA);
    });
  });

  it("no puede tomar un carril de OTRO heat mientras tiene uno activo", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select claim_lane($1)", [s.laneIds[0]]);
      const msg = await expectDenied(() => s.db.query("select claim_lane($1)", [lane2Id]));
      expect(msg).toContain("otro heat");
    });
  });

  it("liberando el primero, puede tomar el del otro heat", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select claim_lane($1)", [s.laneIds[0]]);
      await s.db.query("select transfer_lane($1, null, 'termine')", [s.laneIds[0]]);
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        lane2Id,
      ]);
      expect(res.rows[0].judge_id).toBe(s.users.judgeA);
    });
  });

  it("un lease vencido en el otro heat no cuenta como activo", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));

    await asAdmin(s.db, () =>
      s.db.query("update lanes set lease_expires_at = now() - interval '1 hour' where id = $1", [
        s.laneIds[0],
      ]),
    );

    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        lane2Id,
      ]);
      expect(res.rows[0].judge_id).toBe(s.users.judgeA);
    });
  });
});

describe("claim_lane: autoasignacion configurable", () => {
  it("apagada, un juez comun no puede tomar carril el mismo", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set allow_judge_self_claim = false where id = $1", [s.eventId]),
    );

    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() => s.db.query("select claim_lane($1)", [s.laneIds[0]]));
      expect(msg).toContain("autoasignación");
    });
  });

  it("apagada, la organización SI puede asignar con transfer_lane", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set allow_judge_self_claim = false where id = $1", [s.eventId]),
    );

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ judge_id: string }>(
        "select judge_id from transfer_lane($1, $2, null)",
        [s.laneIds[0], s.users.judgeA],
      );
      expect(res.rows[0].judge_id).toBe(s.users.judgeA);
    });
  });

  it("apagada, quien verifica igual puede autoasignarse", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set allow_judge_self_claim = false where id = $1", [s.eventId]),
    );

    await asUser(s.db, s.users.headJudge, async () => {
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        s.laneIds[0],
      ]);
      expect(res.rows[0].judge_id).toBe(s.users.headJudge);
    });
  });

  it("prendida (default), un juez comun toma su carril sin problema", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        s.laneIds[0],
      ]);
      expect(res.rows[0].judge_id).toBe(s.users.judgeA);
    });
  });
});

describe("transfer_lane: autoliberación", () => {
  it("el juez actual puede soltar su propio carril sin ser verificador", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));

    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ judge_id: string | null }>(
        "select judge_id from transfer_lane($1, null, 'termine mi heat')",
        [s.laneIds[0]],
      );
      expect(res.rows[0].judge_id).toBeNull();
    });
  });

  it("un juez NO puede soltar el carril de OTRO juez", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));

    await asUser(s.db, s.users.judgeB, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select transfer_lane($1, null, null)", [s.laneIds[0]]),
      );
      expect(msg).toContain("juez principal");
    });
  });

  it("la autoliberación queda auditada como release", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));
    await asUser(s.db, s.users.judgeA, () =>
      s.db.query("select transfer_lane($1, null, 'termine')", [s.laneIds[0]]),
    );

    await asAdmin(s.db, async () => {
      const res = await s.db.query<{ action: string }>(
        "select action from lane_audit where lane_id = $1 order by created_at desc limit 1",
        [s.laneIds[0]],
      );
      expect(res.rows[0].action).toBe("release");
    });
  });

  it("no se puede transferir a alguien sin aprobar en el evento", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));

    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select transfer_lane($1, $2, null)", [s.laneIds[0], postulante]),
      );
      expect(msg).toContain("no pertenece a este evento");
    });
  });

  it("se puede transferir a un colaborador de evento aprobado, no solo a org_members", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(`select invite_event_staff($1, 'postulante@fuera.com', 'judge')`, [s.eventId]),
    );

    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ judge_id: string }>(
        "select judge_id from transfer_lane($1, $2, null)",
        [s.laneIds[0], postulante],
      );
      expect(res.rows[0].judge_id).toBe(postulante);
    });
  });
});
