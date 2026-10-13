/**
 * Integridad entre inscripcion, equipo y pago.
 *
 * Tres huecos vistos con datos reales (RomanoFest, octubre 2026):
 *
 * - Borrar un atleta desde /atletas borraba el EQUIPO pero dejaba el tramite
 *   'confirmada' con team_id nulo: seguia ocupando cupo y apareciendo como
 *   confirmado en Inscripciones.
 * - "Marcar como pagada" sin orden confirmaba directo, sin dejar rastro del
 *   pago, y la inscripcion quedaba "incompleto" para siempre.
 * - `confirm_registration` dejaba pasar a quien creo el tramite: un atleta
 *   podia llamar el RPC y confirmarse una categoria paga sin pagar.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asUser, createUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let atleta: string;

beforeEach(async () => {
  s = await seedScenario();
  atleta = await createUser(s.db, "ana@correo.com", "Ana Pérez");

  await asAdmin(s.db, () =>
    s.db.query(
      `update events set starts_at = now() + interval '30 days',
         registration_opens_at = now() - interval '1 day',
         registration_closes_at = now() + interval '20 days',
         published_at = now()
       where id = $1`,
      [s.eventId],
    ),
  );
  await asUser(s.db, s.users.owner, () =>
    s.db.query(
      "insert into division_registration (division_id, event_id, price_cents) values ($1, $2, 150000)",
      [s.divisionId, s.eventId],
    ),
  );
});

/** Un atleta se inscribe solo a la categoria paga y queda esperando pago. */
async function inscripcionPaga(): Promise<string> {
  let id = "";
  await asUser(s.db, atleta, async () => {
    id = (
      await s.db.query<{ id: string }>("select id from start_registration($1, null)", [
        s.divisionId,
      ])
    ).rows[0].id;
    const miembro = (
      await s.db.query<{ id: string }>(
        "select id from registration_members where registration_id = $1",
        [id],
      )
    ).rows[0].id;
    await s.db.query("select save_member_data($1, $2::jsonb)", [
      miembro,
      JSON.stringify({
        firstName: "Ana",
        lastName: "Pérez",
        gender: "female",
        country: "CO",
        acceptTerms: true,
      }),
    ]);
    await s.db.query("select submit_registration($1)", [id]);
  });
  return id;
}

async function readiness(registro: string): Promise<string> {
  let valor = "";
  await asUser(s.db, s.users.owner, async () => {
    valor = (
      await s.db.query<{ r: string }>("select registration_readiness($1) as r", [registro])
    ).rows[0].r;
  });
  return valor;
}

describe("pagar: nadie se confirma solo una categoría paga", () => {
  it("el atleta NO puede llamar confirm_registration sobre su trámite impago", async () => {
    const registro = await inscripcionPaga();

    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select confirm_registration($1)", [registro])),
    );
    expect(mensaje).toMatch(/pago/i);
  });

  it("'Marcar como pagada' sin orden deja la orden pagada y la inscripción lista", async () => {
    const registro = await inscripcionPaga();

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select confirmar_pago_de_inscripcion($1, $2)", [registro, "TRF-123"]);

      const r = await s.db.query<{ status: string; team_id: string | null }>(
        "select status, team_id from registrations where id = $1",
        [registro],
      );
      expect(r.rows[0].status).toBe("confirmada");
      expect(r.rows[0].team_id).not.toBeNull();

      const o = await s.db.query<{ status: string; total_cents: number }>(
        "select status, total_cents from orders where registration_id = $1",
        [registro],
      );
      expect(o.rows[0].status).toBe("pagada");
      expect(o.rows[0].total_cents).toBe(150000);

      // Queda el rastro de quien lo confirmo y con que referencia.
      const intento = await s.db.query<{ external_id: string }>(
        `select pa.external_id from payment_attempts pa
         join orders o on o.id = pa.order_id where o.registration_id = $1`,
        [registro],
      );
      expect(intento.rows[0].external_id).toBe("TRF-123");
    });

    expect(await readiness(registro)).toBe("listo");
  });

  it("el atleta tampoco puede marcar su propio pago", async () => {
    const registro = await inscripcionPaga();

    await asUser(s.db, atleta, () =>
      expectDenied(() =>
        s.db.query("select confirmar_pago_de_inscripcion($1, null)", [registro]),
      ),
    );
  });

  it("un alta manual en categoría paga no queda 'incompleto' por el pago", async () => {
    // El organizador da fe del alta (cortesia, efectivo en mano): no hay orden
    // que esperar, y antes quedaba "incompleto" para siempre.
    let teamId = "";
    await asUser(s.db, s.users.owner, async () => {
      teamId = (
        await s.db.query<{ id: string }>(
          "select id from admin_create_registration($1, null, $2::jsonb)",
          [
            s.divisionId,
            JSON.stringify([
              {
                firstName: "Elena",
                lastName: "Vidal",
                email: "elena@correo.com",
                country: "CO",
                terminosAceptadosOffline: true,
              },
            ]),
          ],
        )
      ).rows[0].id;
    });

    let registro = "";
    await asUser(s.db, s.users.owner, async () => {
      registro = (
        await s.db.query<{ id: string }>("select id from registrations where team_id = $1", [
          teamId,
        ])
      ).rows[0].id;
    });
    expect(await readiness(registro)).toBe("listo");
  });
});

describe("delete_team: el trámite no queda confirmado sin equipo", () => {
  it("un alta manual se borra junto con su equipo", async () => {
    let teamId = "";
    await asUser(s.db, s.users.owner, async () => {
      teamId = (
        await s.db.query<{ id: string }>(
          "select id from admin_create_registration($1, null, $2::jsonb)",
          [
            s.divisionId,
            JSON.stringify([
              { firstName: "Sam", lastName: "M", email: "sam@correo.com", country: "CO" },
            ]),
          ],
        )
      ).rows[0].id;

      await s.db.query("select delete_team($1)", [teamId]);

      const r = await s.db.query(
        `select 1 from registrations r join registration_members m on m.registration_id = r.id
         where m.invited_email = 'sam@correo.com'`,
      );
      expect(r.rows).toHaveLength(0);
    });
  });

  it("una autoinscripción pagada se CANCELA (la orden pagada no se pierde)", async () => {
    const registro = await inscripcionPaga();

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select confirmar_pago_de_inscripcion($1, null)", [registro]);
      const teamId = (
        await s.db.query<{ team_id: string }>(
          "select team_id from registrations where id = $1",
          [registro],
        )
      ).rows[0].team_id;

      await s.db.query("select delete_team($1)", [teamId]);

      const r = await s.db.query<{ status: string; team_id: string | null }>(
        "select status, team_id from registrations where id = $1",
        [registro],
      );
      expect(r.rows[0].status).toBe("cancelada");
      expect(r.rows[0].team_id).toBeNull();

      const o = await s.db.query<{ status: string }>(
        "select status from orders where registration_id = $1",
        [registro],
      );
      expect(o.rows[0].status).toBe("pagada");
    });
  });
});
