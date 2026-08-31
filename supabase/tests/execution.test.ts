/**
 * Bloqueo de carril y largada del heat.
 *
 * El requisito del producto es: "si un juez ya tomo un atleta, la app no debe
 * dejar que otro juez tome o altere estos resultados". Aca se verifica que eso
 * lo sostiene Postgres, no la buena voluntad del cliente.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asUser, expectDenied } from "./harness";
import { asignarJueces, seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

describe("claim_lane", () => {
  it("un juez libre puede tomar un carril", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        s.laneIds[0],
      ]);
      expect(res.rows[0].judge_id).toBe(s.users.judgeA);
    });
  });

  it("un segundo juez NO puede tomar el mismo carril", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));

    await asUser(s.db, s.users.judgeB, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select claim_lane($1)", [s.laneIds[0]]),
      );
      expect(msg).toContain("otro juez");
    });
  });

  it("el carril queda a nombre del primero", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));
    await asUser(s.db, s.users.judgeB, async () => {
      await s.db.query("select claim_lane($1)", [s.laneIds[0]]).catch(() => {});
    });

    await asAdmin(s.db, async () => {
      const res = await s.db.query<{ judge_id: string }>(
        "select judge_id from lanes where id = $1",
        [s.laneIds[0]],
      );
      expect(res.rows[0].judge_id).toBe(s.users.judgeA);
    });
  });

  // NOTA sobre concurrencia real: PGlite tiene una sola conexion, asi que dos
  // `asUser` en paralelo se pisan la sesion y terminan siendo el mismo usuario.
  // Un test de "dos jueces simultaneos" aca pasaria por el motivo equivocado.
  //
  // Lo que si se verifica es el mecanismo que da la garantia: claim_lane hace
  // UN SOLO UPDATE condicional, sin ventana entre verificar y tomar. Bajo
  // concurrencia real Postgres bloquea la fila y reevalua el WHERE contra la
  // version ya modificada, que es exactamente el caso de "el carril ya lo tomo
  // otro juez" de arriba.
  //
  // La concurrencia multi-conexion se valida contra el Supabase real y en el
  // ensayo general de la fase 7.
  it("el UPDATE de claim es condicional: no hay ventana entre verificar y tomar", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[1]]));

    // El mismo predicado que usa claim_lane, ejecutado a mano como juez B.
    await asAdmin(s.db, async () => {
      const res = await s.db.query(
        `update lanes set judge_id = $1
         where id = $2
           and (judge_id is null or judge_id = $1 or lease_expires_at < now())`,
        [s.users.judgeB, s.laneIds[1]],
      );
      expect(res.affectedRows).toBe(0);
    });
  });

  it("el mismo juez puede reclamar su carril de nuevo (renovar el lease)", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      await s.db.query("select claim_lane($1)", [s.laneIds[0]]);
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        s.laneIds[0],
      ]);
      expect(res.rows[0].judge_id).toBe(s.users.judgeA);
    });
  });

  it("un carril abandonado se puede tomar cuando vence el lease", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));

    // Simula que al juez A se le murio el celular hace rato.
    await asAdmin(s.db, () =>
      s.db.query("update lanes set lease_expires_at = now() - interval '1 hour' where id = $1", [
        s.laneIds[0],
      ]),
    );

    await asUser(s.db, s.users.judgeB, async () => {
      const res = await s.db.query<{ judge_id: string }>("select judge_id from claim_lane($1)", [
        s.laneIds[0],
      ]);
      expect(res.rows[0].judge_id).toBe(s.users.judgeB);
    });
  });

  it("alguien ajeno al evento no puede tomar nada", async () => {
    await asUser(s.db, s.users.forastero, async () => {
      const msg = await expectDenied(() => s.db.query("select claim_lane($1)", [s.laneIds[0]]));
      expect(msg).toContain("No pertenec");
    });
  });

  it("el juez no puede asignarse un carril editando la tabla directo", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query("update lanes set judge_id = $1 where id = $2", [
        s.users.judgeA,
        s.laneIds[0],
      ]);
      expect(res.affectedRows).toBe(0);
    });
  });

  it("cada cambio de manos queda auditado", async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ action: string; new_judge_id: string }>(
        "select action, new_judge_id from lane_audit where lane_id = $1",
        [s.laneIds[0]],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]).toMatchObject({ action: "claim", new_judge_id: s.users.judgeA });
    });
  });
});

describe("transfer_lane", () => {
  beforeEach(async () => {
    await asUser(s.db, s.users.judgeA, () => s.db.query("select claim_lane($1)", [s.laneIds[0]]));
  });

  it("el head judge puede transferir un carril a otro juez", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      const res = await s.db.query<{ judge_id: string }>(
        "select judge_id from transfer_lane($1, $2, $3)",
        [s.laneIds[0], s.users.judgeB, "Se quedo sin bateria"],
      );
      expect(res.rows[0].judge_id).toBe(s.users.judgeB);
    });
  });

  it("un juez comun NO puede robarle el carril a otro", async () => {
    await asUser(s.db, s.users.judgeB, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select transfer_lane($1, $2, null)", [s.laneIds[0], s.users.judgeB]),
      );
      expect(msg).toContain("juez principal");
    });
  });

  it("no se puede transferir a alguien ajeno a la organizacion", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const msg = await expectDenied(() =>
        s.db.query("select transfer_lane($1, $2, null)", [s.laneIds[0], s.users.forastero]),
      );
      expect(msg).toContain("no pertenece");
    });
  });

  it("transferir a null libera el carril y lo registra como release", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select transfer_lane($1, null, 'Juez no se presento')", [s.laneIds[0]]);
      const res = await s.db.query<{ action: string }>(
        "select action from lane_audit where lane_id = $1 order by created_at desc limit 1",
        [s.laneIds[0]],
      );
      expect(res.rows[0].action).toBe("release");
    });
  });
});

describe("start_heat", () => {
  // La base no larga un heat con carriles sin juez.
  beforeEach(() => asignarJueces(s));

  it("el organizador larga el heat y queda corriendo", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ status: string; start_source: string }>(
        "select status, start_source from start_heat($1)",
        [s.heatId],
      );
      expect(res.rows[0]).toMatchObject({ status: "running", start_source: "server" });
    });
  });

  // Este es el caso que arruina una competencia: seis atletas en carrera y
  // alguien vuelve a tocar el boton de largada.
  it("largar dos veces NO reinicia el reloj", async () => {
    let primera: string | null = null;

    await asUser(s.db, s.users.owner, async () => {
      const r1 = await s.db.query<{ started_at: string }>(
        "select started_at from start_heat($1)",
        [s.heatId],
      );
      primera = r1.rows[0].started_at;

      const r2 = await s.db.query<{ started_at: string }>(
        "select started_at from start_heat($1)",
        [s.heatId],
      );
      expect(r2.rows[0].started_at).toEqual(primera);
    });
  });

  it("largar pone los carriles con equipo en running", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select start_heat($1)", [s.heatId]);
      const res = await s.db.query<{ status: string }>(
        "select status from lanes where heat_id = $1",
        [s.heatId],
      );
      expect(res.rows.every((r) => r.status === "running")).toBe(true);
    });
  });

  // Regresion: antes se podia largar con el evento en borrador. Quedaba el heat
  // corriendo y la pantalla del juez vacia, sin ninguna pista de por que.
  it("no se puede largar un heat con la competencia en borrador", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update events set status = 'draft' where id = $1", [s.eventId]);
      const msg = await expectDenied(() => s.db.query("select start_heat($1)", [s.heatId]));
      expect(msg).toContain("borrador");
    });
  });

  it("largar el primer heat pone la competencia en vivo sola", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update events set status = 'ready' where id = $1", [s.eventId]);
      await s.db.query("select start_heat($1)", [s.heatId]);

      const res = await s.db.query<{ status: string }>("select status from events where id = $1", [
        s.eventId,
      ]);
      expect(res.rows[0].status).toBe("live");
    });
  });

  it("no se largan heats nuevos si la competencia ya termino", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update events set status = 'published' where id = $1", [s.eventId]);
      const msg = await expectDenied(() => s.db.query("select start_heat($1)", [s.heatId]));
      expect(msg).toContain("no se pueden iniciar");
    });
  });

  it("un juez comun no puede largar el heat", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const msg = await expectDenied(() => s.db.query("select start_heat($1)", [s.heatId]));
      expect(msg).toContain("permiso");
    });
  });

  // Regresion: can_verify_event() devolvia NULL en vez de false para quien no
  // es miembro, y `if not NULL then` no entra al bloque. El guard dejaba pasar
  // justo al caso que mas importa frenar.
  it("alguien ajeno al evento tampoco puede largarlo", async () => {
    await asUser(s.db, s.users.forastero, async () => {
      const msg = await expectDenied(() => s.db.query("select start_heat($1)", [s.heatId]));
      expect(msg).toContain("permiso");
    });
  });
});

describe("integridad del armado", () => {
  it("un equipo no puede estar en dos carriles del evento", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const otroHeat = await s.db.query<{ id: string }>(
        "insert into heats (event_id, name, lane_count) values ($1, 'Heat 2', 3) returning id",
        [s.eventId],
      );
      await expectDenied(() =>
        s.db.query(
          "insert into lanes (heat_id, event_id, lane_number, team_id) values ($1, $2, 1, $3)",
          [otroHeat.rows[0].id, s.eventId, s.teamIds[0]],
        ),
      );
    });
  });

  it("no puede haber dos carriles con el mismo numero en un heat", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await expectDenied(() =>
        s.db.query("insert into lanes (heat_id, event_id, lane_number) values ($1, $2, 1)", [
          s.heatId,
          s.eventId,
        ]),
      );
    });
  });

  it("no puede haber dos dorsales iguales en un evento", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await expectDenied(() =>
        s.db.query("insert into teams (event_id, division_id, bib_number) values ($1, $2, 101)", [
          s.eventId,
          s.divisionId,
        ]),
      );
    });
  });
});
