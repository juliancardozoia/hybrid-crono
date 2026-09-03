/**
 * El gate del plan, aplicado donde no se puede saltear.
 *
 * Todo lo que separa el plan gratuito del pago se verifica ACA, contra Postgres,
 * y no leyendo lo que muestra un componente. Una server action se saltea con una
 * llamada directa a PostgREST usando la misma sesión del organizador; un trigger
 * y una función SECURITY DEFINER, no.
 *
 * Lo que NO se restringe, y por eso se prueba explícitamente: el cronómetro de
 * un circuito sigue funcionando igual en el plan gratuito. El corte es por
 * visibilidad, no por captura.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

async function setPlan(plan: "free" | "pro"): Promise<void> {
  await asAdmin(s.db, () =>
    s.db.query("update organizations set plan = $1 where id = $2", [plan, s.orgId]),
  );
}

async function setStatus(status: string): Promise<void> {
  await asAdmin(s.db, () =>
    s.db.query("update events set status = $1 where id = $2", [status, s.eventId]),
  );
}

/** Otro evento de la misma organización, en borrador. */
async function otroEvento(nombre = "Otra Copa"): Promise<string> {
  let id = "";
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ id: string }>(
      `insert into events (org_id, name, public_slug, status)
       values ($1, $2, $3, 'draft') returning id`,
      [s.orgId, nombre, nombre.toLowerCase().replace(/\s+/g, "-")],
    );
    id = res.rows[0].id;
  });
  return id;
}

/** Una prueba que NO es un circuito, con el modo de captura que se le pida. */
async function crearPrueba(captureMode: "manual" | "en_vivo"): Promise<string> {
  let partId = "";
  await asUser(s.db, s.users.owner, async () => {
    const w = await s.db.query<{ id: string }>(
      "insert into workouts (event_id, order_index, name) values ($1, 9, 'Evento 3') returning id",
      [s.eventId],
    );
    const p = await s.db.query<{ id: string }>(
      `insert into workout_parts (
         workout_id, event_id, order_index, time_scheme, capture_mode,
         score_unit, score_dir, window_ms
       ) values ($1, $2, 0, 'ventana', $3, 'rondas_reps', 'mayor_gana', 720000)
       returning id`,
      [w.rows[0].id, s.eventId, captureMode],
    );
    partId = p.rows[0].id;
  });
  return partId;
}

async function guardarTarjeta(): Promise<void> {
  await asUser(s.db, s.users.owner, () =>
    s.db.query("select guardar_medio_de_cobro($1, 'stripe', 'tok_visa_123', 'visa', '4242', 12, 2030)", [
      s.orgId,
    ]),
  );
}

// ---------------------------------------------------------------------------

describe("una competencia a la vez en el plan gratuito", () => {
  it("un segundo evento no puede activarse mientras el primero corre", async () => {
    const otro = await otroEvento();
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query("update events set status = 'ready' where id = $1", [otro]),
      ),
    );
    expect(mensaje).toMatch(/una competencia a la vez/i);
    expect(mensaje).toContain("Copa Test");
  });

  it("pero preparar borradores en paralelo no cuesta nada", async () => {
    await otroEvento("Copa Dos");
    await otroEvento("Copa Tres");
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*) as n from events where org_id = $1",
        [s.orgId],
      );
      expect(res.rows[0].n).toBe(3);
    });
  });

  it("con la primera terminada, la siguiente arranca sin problema", async () => {
    const otro = await otroEvento();
    // `published` es una competencia que ya terminó: libera el cupo.
    await setStatus("published");
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update events set status = 'ready' where id = $1", [otro]),
    );
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ status: string }>(
        "select status from events where id = $1",
        [otro],
      );
      expect(res.rows[0].status).toBe("ready");
    });
  });

  it("en plan pro corren dos a la vez", async () => {
    await setPlan("pro");
    const otro = await otroEvento();
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update events set status = 'live' where id = $1", [otro]),
    );
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*) as n from events where org_id = $1 and status = 'live'",
        [s.orgId],
      );
      expect(res.rows[0].n).toBe(2);
    });
  });

  it("guardar cualquier otra cosa del evento activo no vuelve a chequear el cupo", async () => {
    // El trigger sale temprano cuando el estado no cambió. Sin eso, editar el
    // nombre de un evento en vivo dispararía la validación contra sí mismo.
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update events set name = 'Copa Test 2026' where id = $1", [s.eventId]),
    );
  });
});

describe("juzgar un WOD en vivo es del plan pro", () => {
  it("el plan gratuito no deja crear una prueba en vivo", async () => {
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() => crearPrueba("en_vivo")),
    );
    expect(mensaje).toMatch(/plan Pro/i);
  });

  it("tampoco deja pasar a en vivo una prueba que ya existe", async () => {
    const parte = await crearPrueba("manual");
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query("update workout_parts set capture_mode = 'en_vivo' where id = $1", [parte]),
      ),
    );
    expect(mensaje).toMatch(/cargan a mano/i);
  });

  it("EL CIRCUITO SIGUE EN VIVO EN EL PLAN GRATUITO", async () => {
    // La promesa central del modelo de negocio: a quien ya cronometraba su
    // Hyrox con la app no se le quita nada.
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ capture_mode: string }>(
        `select p.capture_mode from workout_parts p
         where p.event_id = $1 and p.time_scheme = 'circuito'`,
        [s.eventId],
      );
      expect(res.rows[0].capture_mode).toBe("en_vivo");
    });

    // Y se puede crear otro circuito en vivo, sin plan pago.
    await asUser(s.db, s.users.owner, async () => {
      const w = await s.db.query<{ id: string }>(
        "insert into workouts (event_id, order_index, name) values ($1, 8, 'Otro circuito') returning id",
        [s.eventId],
      );
      await s.db.query(
        `insert into workout_parts (
           workout_id, event_id, order_index, time_scheme, capture_mode, score_unit, score_dir
         ) values ($1, $2, 0, 'circuito', 'en_vivo', 'tiempo', 'menor_gana')`,
        [w.rows[0].id, s.eventId],
      );
    });
  });

  it("en plan pro se juzga en vivo cualquier prueba", async () => {
    await setPlan("pro");
    const parte = await crearPrueba("en_vivo");
    expect(parte).toBeTruthy();
  });

  it("editar otra cosa de una prueba en vivo no la vuelve a validar", async () => {
    // Si el trigger no saliera temprano, un evento que ya corrió quedaría
    // congelado para siempre al cancelarse el plan.
    await setPlan("pro");
    const parte = await crearPrueba("en_vivo");
    await setPlan("free");
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update workout_parts set label = 'A' where id = $1", [parte]),
    );
  });
});

describe("aparecer en el catálogo es del plan pro", () => {
  beforeEach(async () => {
    await asAdmin(s.db, () =>
      s.db.query(
        `update events set starts_at = now() + interval '30 days', country = 'CO'
         where id = $1`,
        [s.eventId],
      ),
    );
  });

  it("el plan gratuito no publica", async () => {
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select publish_event($1)", [s.eventId])),
    );
    expect(mensaje).toMatch(/catalogo publico es del plan Pro/i);
  });

  it("y el evento no aparece listado", async () => {
    await asAnon(s.db, async () => {
      const res = await s.db.query("select * from public_events_catalog()");
      expect(res.rows).toHaveLength(0);
    });
  });

  it("en plan pro publica y aparece", async () => {
    await setPlan("pro");
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select publish_event($1)", [s.eventId]),
    );
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ public_slug: string }>(
        "select public_slug from public_events_catalog()",
      );
      expect(res.rows.map((r) => r.public_slug)).toContain("copa-test");
    });
  });

  it("las validaciones de siempre siguen antes que la del plan", async () => {
    // Un evento sin fecha no se publica ni pagando: el mensaje tiene que hablar
    // de la fecha, no del plan.
    await setPlan("pro");
    await asAdmin(s.db, () =>
      s.db.query("update events set starts_at = null where id = $1", [s.eventId]),
    );
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select publish_event($1)", [s.eventId])),
    );
    expect(mensaje).toMatch(/fecha/i);
  });
});

describe("el medio de cobro del organizador", () => {
  it("sin tarjeta no se activa el plan pro", async () => {
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select activar_plan_pro($1)", [s.orgId])),
    );
    expect(mensaje).toMatch(/tarjeta/i);
  });

  it("con tarjeta sí", async () => {
    await guardarTarjeta();
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ activar_plan_pro: string }>(
        "select activar_plan_pro($1)",
        [s.orgId],
      );
      expect(res.rows[0].activar_plan_pro).toBe("pro");
    });
  });

  it("el token de la tarjeta NO se puede leer, ni siendo dueño", async () => {
    // Fuera del grant a propósito, igual que payment_providers.secret_ciphertext.
    await guardarTarjeta();
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select card_token from billing_accounts")),
    );
  });

  it("pero los últimos cuatro dígitos sí, que es lo que el organizador reconoce", async () => {
    await guardarTarjeta();
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ card_brand: string; card_last4: string }>(
        "select card_brand, card_last4 from billing_accounts where org_id = $1",
        [s.orgId],
      );
      expect(res.rows[0].card_last4).toBe("4242");
      expect(res.rows[0].card_brand).toBe("visa");
    });
  });

  it("cambiar la tarjeta no borra los datos de facturación", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        `select guardar_medio_de_cobro($1, 'stripe', 'tok_1', 'visa', '4242', 12, 2030,
           'Ana Ruiz', '900123456-7', 'pagos@box.com')`,
        [s.orgId],
      ),
    );
    await guardarTarjeta(); // la misma función, sin datos de facturación
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ tax_id: string; billing_email: string }>(
        "select tax_id, billing_email from billing_accounts where org_id = $1",
        [s.orgId],
      );
      expect(res.rows[0].tax_id).toBe("900123456-7");
      expect(res.rows[0].billing_email).toBe("pagos@box.com");
    });
  });

  it("un juez de la organización no toca el plan ni la tarjeta", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      await expectDenied(() =>
        s.db.query("select guardar_medio_de_cobro($1, 'stripe', 'tok_x')", [s.orgId]),
      );
      await expectDenied(() => s.db.query("select activar_plan_pro($1)", [s.orgId]));
    });
  });

  it("el anónimo no llega a la tabla ni a las funciones", async () => {
    await guardarTarjeta();
    await asAnon(s.db, async () => {
      await expectDenied(() => s.db.query("select * from billing_accounts"));
      await expectDenied(() => s.db.query("select activar_plan_pro($1)", [s.orgId]));
      await expectDenied(() =>
        s.db.query("select guardar_medio_de_cobro($1, 'x', 'y')", [s.orgId]),
      );
    });
  });
});

describe("volver al plan gratuito", () => {
  beforeEach(async () => {
    await guardarTarjeta();
    await setPlan("pro");
  });

  it("no se puede con una competencia en curso", async () => {
    // El fixture deja el evento en `live`: cancelar acá apagaría el proyector
    // en el peor momento posible.
    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() => s.db.query("select cancelar_plan_pro($1)", [s.orgId])),
    );
    expect(mensaje).toMatch(/en curso/i);
  });

  it("y sí una vez terminada", async () => {
    await setStatus("published");
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ cancelar_plan_pro: string }>(
        "select cancelar_plan_pro($1)",
        [s.orgId],
      );
      expect(res.rows[0].cancelar_plan_pro).toBe("free");
    });
  });
});

describe("event_plan_status", () => {
  interface Estado {
    plan: string;
    puedePublicar: boolean;
    puedeJuzgarEnVivo: boolean;
    otrasActivas: number;
    pruebasManualesForzadas: number;
    tieneTarjeta: boolean;
  }

  async function estado(user: string): Promise<Estado | null> {
    return asUser(s.db, user, async () => {
      const res = await s.db.query<{ event_plan_status: Estado | null }>(
        "select event_plan_status($1)",
        [s.eventId],
      );
      return res.rows[0].event_plan_status;
    });
  }

  it("en plan gratuito dice qué falta", async () => {
    await crearPrueba("manual");
    const e = await estado(s.users.owner);
    expect(e).toMatchObject({
      plan: "free",
      puedePublicar: false,
      puedeJuzgarEnVivo: false,
      tieneTarjeta: false,
    });
    // El circuito no cuenta: se juzga en vivo igual.
    expect(e?.pruebasManualesForzadas).toBe(1);
  });

  it("en plan pro no fuerza nada a mano", async () => {
    await crearPrueba("manual");
    await setPlan("pro");
    const e = await estado(s.users.owner);
    expect(e).toMatchObject({ plan: "pro", puedePublicar: true, puedeJuzgarEnVivo: true });
    expect(e?.pruebasManualesForzadas).toBe(0);
  });

  it("cuenta las otras competencias que ocupan el cupo", async () => {
    await setPlan("pro");
    const otro = await otroEvento();
    await asUser(s.db, s.users.owner, () =>
      s.db.query("update events set status = 'live' where id = $1", [otro]),
    );
    const e = await estado(s.users.owner);
    expect(e?.otrasActivas).toBe(1);
  });

  it("un juez del evento lo puede consultar", async () => {
    // El colaborador ve por qué una pantalla está apagada, en vez de creer que
    // se rompió.
    const e = await estado(s.users.judgeA);
    expect(e?.plan).toBe("free");
  });

  it("un forastero no obtiene nada", async () => {
    expect(await estado(s.users.forastero)).toBeNull();
  });

  it("el anónimo no la puede invocar", async () => {
    await asAnon(s.db, () =>
      expectDenied(() => s.db.query("select event_plan_status($1)", [s.eventId])),
    );
  });
});
