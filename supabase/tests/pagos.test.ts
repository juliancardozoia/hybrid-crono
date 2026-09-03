/**
 * Pagos.
 *
 * Lo que más importa acá: el texto cifrado de las credenciales NO sale de la
 * base ni para quien administra la organización, y un pago aprobado cierra el
 * círculo confirmando la inscripción — que es donde nace el equipo.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, createUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let atleta: string;
let registro: string;

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

  // Una categoría con precio: es lo que hace que exista una orden.
  await asUser(s.db, s.users.owner, () =>
    s.db.query(
      "insert into division_registration (division_id, event_id, price_cents) values ($1, $2, 200000)",
      [s.divisionId, s.eventId],
    ),
  );

  await asUser(s.db, atleta, async () => {
    const r = await s.db.query<{ id: string }>("select id from start_registration($1)", [
      s.divisionId,
    ]);
    registro = r.rows[0].id;

    const m = await s.db.query<{ id: string }>(
      "select id from registration_members where registration_id = $1",
      [registro],
    );
    await s.db.query("select save_member_data($1, $2::jsonb)", [
      m.rows[0].id,
      JSON.stringify({ firstName: "Ana", lastName: "Pérez", acceptTerms: true }),
    ]);
    await s.db.query("select submit_registration($1)", [registro]);
  });
});

async function crearOrden(codigo?: string): Promise<{ id: string; total_cents: number }> {
  let orden = { id: "", total_cents: 0 };
  await asUser(s.db, atleta, async () => {
    const res = await s.db.query<{ id: string; total_cents: number }>(
      "select id, total_cents from upsert_order($1, $2)",
      [registro, codigo ?? null],
    );
    orden = res.rows[0];
  });
  return orden;
}

describe("las credenciales de la pasarela", () => {
  beforeEach(async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        `insert into payment_providers (org_id, provider, label, public_config, secret_ciphertext)
         values ($1, 'mercadopago', 'Cuenta del club', $2::jsonb, 'v1.aaa.bbb.ccc')`,
        [s.orgId, JSON.stringify({ publicKey: "APP_USR-publica" })],
      ),
    );
  });

  it("el texto cifrado NO se puede leer, ni siquiera siendo dueño de la organización", async () => {
    // La columna quedó fuera del grant de select a propósito. Un `grant select`
    // a secas la habría incluido.
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select secret_ciphertext from payment_providers")),
    );
  });

  it("pero el resto de la configuración sí se lee", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ provider: string; label: string }>(
        "select provider, label from payment_providers where org_id = $1",
        [s.orgId],
      );
      expect(res.rows[0].provider).toBe("mercadopago");
      expect(res.rows[0].label).toBe("Cuenta del club");
    });
  });

  it("un juez de la organización no ve la configuración de cobro", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query("select id from payment_providers");
      expect(res.rows).toEqual([]);
    });
  });

  it("el anónimo ni siquiera puede preguntar", async () => {
    await asAnon(s.db, () =>
      expectDenied(() => s.db.query("select id from payment_providers")),
    );
  });

  it("los medios de pago llegan al atleta sin el secreto", async () => {
    await asUser(s.db, atleta, async () => {
      const res = await s.db.query<{
        medios_de_pago: Array<{ provider: string; configurado: boolean; publicConfig: unknown }>;
      }>("select medios_de_pago($1)", [registro]);

      const medios = res.rows[0].medios_de_pago;
      expect(medios).toHaveLength(1);
      expect(medios[0].configurado).toBe(true);
      expect(JSON.stringify(medios)).not.toContain("v1.aaa");
    });
  });
});

describe("la orden", () => {
  it("una inscripción con precio genera una orden por su monto", async () => {
    const orden = await crearOrden();
    expect(orden.total_cents).toBe(200000);
  });

  it("pedirla dos veces no crea dos órdenes", async () => {
    await crearOrden();
    await crearOrden();
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from orders where registration_id = $1",
        [registro],
      );
      expect(res.rows[0].n).toBe(1);
    });
  });

  it("una inscripción sin costo no genera orden", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update division_registration set price_cents = 0 where division_id = $1", [
        s.divisionId,
      ]),
    );
    const otro = await createUser(s.db, "beto@correo.com");
    await asUser(s.db, otro, async () => {
      const r = await s.db.query<{ id: string }>("select id from start_registration($1)", [
        s.divisionId,
      ]);
      await expectDenied(() =>
        s.db.query("select upsert_order($1)", [r.rows[0].id]),
      );
    });
  });

  it("un tercero no puede armar la orden de otro", async () => {
    const tercero = await createUser(s.db, "tercero@correo.com");
    await asUser(s.db, tercero, () =>
      expectDenied(() => s.db.query("select upsert_order($1)", [registro])),
    );
  });
});

describe("descuentos", () => {
  async function crearCodigo(campos: Record<string, unknown>): Promise<void> {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        `insert into discount_codes (event_id, code, kind, value, division_id, max_uses, valid_from, valid_to, active)
         values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::boolean, true))`,
        [
          s.eventId,
          campos.code,
          campos.kind ?? "porcentaje",
          campos.value ?? 10,
          campos.divisionId ?? null,
          campos.maxUses ?? null,
          campos.validFrom ?? null,
          campos.validTo ?? null,
          campos.active ?? null,
        ],
      ),
    );
  }

  it("un porcentaje descuenta lo que corresponde", async () => {
    await crearCodigo({ code: "EARLY20", kind: "porcentaje", value: 20 });
    expect((await crearOrden("EARLY20")).total_cents).toBe(160000);
  });

  it("un monto fijo también", async () => {
    await crearCodigo({ code: "MENOS50", kind: "monto", value: 50000 });
    expect((await crearOrden("MENOS50")).total_cents).toBe(150000);
  });

  it("no distingue mayúsculas: nadie escribe un cupón como se lo dieron", async () => {
    await crearCodigo({ code: "EARLY20", value: 20 });
    expect((await crearOrden("early20")).total_cents).toBe(160000);
  });

  it("un descuento nunca deja el total en negativo", async () => {
    await crearCodigo({ code: "REGALO", kind: "monto", value: 999999 });
    expect((await crearOrden("REGALO")).total_cents).toBe(0);
  });

  it("un código que no existe lo dice", async () => {
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select upsert_order($1, 'INVENTADO')", [registro])),
    );
    expect(mensaje).toMatch(/no existe/i);
  });

  it("un código vencido lo dice", async () => {
    await crearCodigo({ code: "VIEJO", validTo: new Date(Date.now() - 86400000).toISOString() });
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select upsert_order($1, 'VIEJO')", [registro])),
    );
    expect(mensaje).toMatch(/venci/i);
  });

  it("un código de otra categoría no aplica", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const templateId = (
        await s.db.query<{ course_template_id: string }>(
          "select course_template_id from divisions where id = $1",
          [s.divisionId],
        )
      ).rows[0].course_template_id;
      const otra = await s.db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Otra', 1, 'any', $2) returning id`,
        [s.eventId, templateId],
      );
      await s.db.query(
        `insert into discount_codes (event_id, code, kind, value, division_id)
         values ($1, 'SOLOOTRA', 'porcentaje', 50, $2)`,
        [s.eventId, otra.rows[0].id],
      );
    });

    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select upsert_order($1, 'SOLOOTRA')", [registro])),
    );
    expect(mensaje).toMatch(/no aplica/i);
  });

  it("el cupón se gasta recién cuando el pago entra de verdad", async () => {
    // Contarlo antes deja códigos agotados por gente que nunca pagó.
    await crearCodigo({ code: "UNICO", value: 10, maxUses: 1 });
    const orden = await crearOrden("UNICO");

    await asUser(s.db, s.users.owner, async () => {
      const antes = await s.db.query<{ used_count: number }>(
        "select used_count from discount_codes where upper(code) = 'UNICO'",
      );
      expect(antes.rows[0].used_count).toBe(0);

      await s.db.query("select confirmar_pago_manual($1)", [orden.id]);

      const despues = await s.db.query<{ used_count: number }>(
        "select used_count from discount_codes where upper(code) = 'UNICO'",
      );
      expect(despues.rows[0].used_count).toBe(1);
    });
  });

  it("un cupón agotado deja de aplicar", async () => {
    await crearCodigo({ code: "UNICO", value: 10, maxUses: 1 });
    await asAdmin(s.db, () =>
      s.db.query("update discount_codes set used_count = 1 where upper(code) = 'UNICO'"),
    );
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select upsert_order($1, 'UNICO')", [registro])),
    );
    expect(mensaje).toMatch(/agot/i);
  });
});

describe("cobrar cierra el círculo", () => {
  it("un pago aprobado confirma la inscripción y crea el equipo", async () => {
    const orden = await crearOrden();

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select confirmar_pago_manual($1, 'TRF-123')", [orden.id]);

      const res = await s.db.query<{ status: string; team_id: string | null }>(
        "select status, team_id from registrations where id = $1",
        [registro],
      );
      expect(res.rows[0].status).toBe("confirmada");
      expect(res.rows[0].team_id).not.toBeNull();
    });
  });

  it("un webhook que llega tres veces cobra una sola vez", async () => {
    // Es lo normal, no la excepción: las pasarelas reintentan.
    const orden = await crearOrden();

    await asAdmin(s.db, async () => {
      for (let i = 0; i < 3; i++) {
        await s.db.query(
          "select registrar_intento_de_pago($1, 'mercadopago', 'aprobado', 'MP-999', 200000)",
          [orden.id],
        );
      }

      const intentos = await s.db.query<{ n: number }>(
        "select count(*)::int as n from payment_attempts where order_id = $1",
        [orden.id],
      );
      expect(intentos.rows[0].n).toBe(1);

      const equipos = await s.db.query<{ n: number }>(
        "select count(*)::int as n from teams where event_id = $1",
        [s.eventId],
      );
      // Los 3 del fixture y uno solo del pago.
      expect(equipos.rows[0].n).toBe(4);
    });
  });

  it("un pago rechazado deja la orden fallida y no confirma nada", async () => {
    const orden = await crearOrden();

    await asAdmin(s.db, async () => {
      await s.db.query(
        "select registrar_intento_de_pago($1, 'mercadopago', 'rechazado', 'MP-RECH')",
        [orden.id],
      );

      const o = await s.db.query<{ status: string }>("select status from orders where id = $1", [
        orden.id,
      ]);
      expect(o.rows[0].status).toBe("fallida");

      const r = await s.db.query<{ status: string }>(
        "select status from registrations where id = $1",
        [registro],
      );
      expect(r.rows[0].status).toBe("esperando_pago");
    });
  });

  it("una orden pagada no se recalcula", async () => {
    const orden = await crearOrden();
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select confirmar_pago_manual($1)", [orden.id]),
    );

    // El monto cobrado es historia: aunque se pida de nuevo con un cupón, no
    // cambia.
    await asUser(s.db, atleta, async () => {
      const res = await s.db.query<{ total_cents: number; status: string }>(
        "select total_cents, status from upsert_order($1)",
        [registro],
      );
      expect(res.rows[0].status).toBe("pagada");
      expect(res.rows[0].total_cents).toBe(200000);
    });
  });

  it("solo la organización confirma un pago a mano", async () => {
    const orden = await crearOrden();
    await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select confirmar_pago_manual($1)", [orden.id])),
    );
  });

  it("el atleta ve su orden y el estado del pago", async () => {
    const orden = await crearOrden();
    await asUser(s.db, atleta, async () => {
      const res = await s.db.query<{ status: string }>("select status from orders where id = $1", [
        orden.id,
      ]);
      expect(res.rows[0].status).toBe("pendiente");
    });
  });

  it("pero no ve los intentos: son rastro de auditoría de la organización", async () => {
    const orden = await crearOrden();
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select confirmar_pago_manual($1)", [orden.id]),
    );
    await asUser(s.db, atleta, async () => {
      const res = await s.db.query("select id from payment_attempts");
      expect(res.rows).toEqual([]);
    });
  });

  it("nadie escribe órdenes ni intentos directamente", async () => {
    const orden = await crearOrden();
    for (const usuario of [atleta, s.users.owner]) {
      await asUser(s.db, usuario, async () => {
        await expectDenied(() =>
          s.db.query("update orders set status = 'pagada' where id = $1", [orden.id]),
        );
        await expectDenied(() =>
          s.db.query(
            "insert into payment_attempts (order_id, event_id, provider, status) values ($1, $2, 'paypal', 'aprobado')",
            [orden.id, s.eventId],
          ),
        );
      });
    }
  });
});
