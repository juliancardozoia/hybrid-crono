/**
 * Correos transaccionales: outbox, disparadores, supresiones y limites.
 *
 * Lo que mas importa aca: (1) cada camino que confirma una inscripcion o invita
 * a alguien deja EXACTAMENTE un correo, aunque el hecho se repita; (2) ningun
 * cliente puede leer ni escribir la cola ni mandar correo a una direccion
 * arbitraria; (3) un fallo del proveedor reintenta y termina.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, createUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let atleta: string;
let companero: string;
let divisionParejas: string;

beforeEach(async () => {
  s = await seedScenario();

  atleta = await createUser(s.db, "ana@correo.com", "Ana Pérez");
  companero = await createUser(s.db, "beto@correo.com", "Beto Gómez");

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

  await asUser(s.db, s.users.owner, async () => {
    const templateId = (
      await s.db.query<{ course_template_id: string }>(
        "select course_template_id from divisions where id = $1",
        [s.divisionId],
      )
    ).rows[0].course_template_id;

    divisionParejas = (
      await s.db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Parejas Mixtas', 2, 'mixed', $2) returning id`,
        [s.eventId, templateId],
      )
    ).rows[0].id;
  });
});

interface FilaDeCorreo {
  kind: string;
  to_email: string;
  status: string;
  payload: Record<string, unknown>;
}

async function correos(kind?: string): Promise<FilaDeCorreo[]> {
  return asAdmin(s.db, async () => {
    const res = await s.db.query<FilaDeCorreo>(
      `select kind, to_email, status, payload from email_outbox
       where ($1::text is null or kind = $1) order by created_at, to_email`,
      [kind ?? null],
    );
    return res.rows;
  });
}

async function empezar(divisionId: string, usuario = atleta, nombre?: string): Promise<string> {
  let id = "";
  await asUser(s.db, usuario, async () => {
    const res = await s.db.query<{ id: string }>("select id from start_registration($1, $2)", [
      divisionId,
      nombre ?? null,
    ]);
    id = res.rows[0].id;
  });
  return id;
}

async function invitar(registro: string, posicion: number, email: string, usuario = atleta) {
  await asUser(s.db, usuario, () =>
    s.db.query("select invite_member($1, $2, $3)", [registro, posicion, email]),
  );
}

const DATOS = {
  firstName: "Ana",
  lastName: "Pérez",
  gender: "female",
  country: "CO",
  acceptTerms: true,
};

async function miembros(registro: string): Promise<string[]> {
  return asAdmin(s.db, async () => {
    const res = await s.db.query<{ id: string }>(
      "select id from registration_members where registration_id = $1 order by position",
      [registro],
    );
    return res.rows.map((r) => r.id);
  });
}

async function completarYEnviar(registro: string, parejas = false) {
  const ids = await miembros(registro);
  await asUser(s.db, atleta, () =>
    s.db.query("select save_member_data($1, $2::jsonb)", [ids[0], JSON.stringify(DATOS)]),
  );
  if (parejas) {
    await asUser(s.db, companero, () =>
      s.db.query("select save_member_data($1, $2::jsonb)", [
        ids[1],
        JSON.stringify({ ...DATOS, firstName: "Beto", lastName: "Gómez", gender: "male" }),
      ]),
    );
  }
  await asUser(s.db, atleta, () => s.db.query("select submit_registration($1)", [registro]));
}

describe("invitar a un integrante", () => {
  it("encola una invitacion con el link al tramite, y no le escribe al capitan", async () => {
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    // Empezar deja al capitan como integrante 1: no es una invitacion.
    expect(await correos()).toHaveLength(0);

    await invitar(registro, 2, "Beto@Correo.com");

    const filas = await correos("invitacion_equipo");
    expect(filas).toHaveLength(1);
    expect(filas[0].to_email).toBe("beto@correo.com");
    expect(filas[0].status).toBe("pendiente");
    expect(filas[0].payload).toMatchObject({
      path: `/inscripcion/${registro}`,
      event_name: "Copa Test",
      division_name: "Parejas Mixtas",
      team_name: "Los Fuertes",
      captain_name: "Ana Pérez",
      position: 2,
    });
  });

  it("re-invitar el mismo correo no manda otro; cambiar de persona si", async () => {
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await invitar(registro, 2, "beto@correo.com");
    await invitar(registro, 2, "beto@correo.com");
    expect(await correos("invitacion_equipo")).toHaveLength(1);

    await invitar(registro, 2, "carla@correo.com");
    const filas = await correos("invitacion_equipo");
    expect(filas.map((f) => f.to_email)).toEqual(["beto@correo.com", "carla@correo.com"]);
  });

  it("guarda el idioma de quien invita como pista para quien todavia no tiene cuenta", async () => {
    await asAdmin(s.db, () => s.db.query("update profiles set locale = 'pt' where id = $1", [atleta]));
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await invitar(registro, 2, "nuevo@correo.com");

    const [fila] = await correos("invitacion_equipo");
    expect(fila.payload.locale_hint).toBe("pt");
  });

  it("un alta del organizador no invita a nadie por correo", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select admin_create_registration($1, 'Dupla Manual', $2::jsonb)", [
        divisionParejas,
        JSON.stringify([
          { firstName: "Uno", lastName: "A", email: "uno@correo.com", country: "CO", gender: "male" },
          { firstName: "Dos", lastName: "B", email: "dos@correo.com", country: "CO", gender: "female" },
        ]),
      ]),
    );
    expect(await correos()).toHaveLength(0);
  });
});

describe("inscripcion confirmada", () => {
  it("le llega a cada integrante, una sola vez", async () => {
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await invitar(registro, 2, "beto@correo.com");
    await completarYEnviar(registro, true);

    const filas = await correos("inscripcion_confirmada");
    expect(filas.map((f) => f.to_email)).toEqual(["ana@correo.com", "beto@correo.com"]);

    // Confirmar de nuevo (un webhook repetido) no duplica.
    await asUser(s.db, atleta, () => s.db.query("select confirm_registration($1)", [registro]));
    expect(await correos("inscripcion_confirmada")).toHaveLength(2);
  });

  it("una inscripcion a medias no manda nada de confirmacion", async () => {
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await invitar(registro, 2, "beto@correo.com");
    expect(await correos("inscripcion_confirmada")).toHaveLength(0);
    expect(registro).toBeTruthy();
  });

  it("un alta del organizador no notifica al atleta", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select admin_create_registration($1, null, $2::jsonb)", [
        s.divisionId,
        JSON.stringify([
          { firstName: "Uno", lastName: "A", email: "uno@correo.com", country: "CO", gender: "male" },
        ]),
      ]),
    );
    expect(await correos("inscripcion_confirmada")).toHaveLength(0);
  });
});

describe("pago recibido", () => {
  it("le llega al capitan cuando entra el pago, y una sola vez aunque el webhook repita", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        "insert into division_registration (division_id, event_id, price_cents) values ($1, $2, 200000)",
        [s.divisionId, s.eventId],
      ),
    );
    const registro = await empezar(s.divisionId);
    await completarYEnviar(registro);

    let ordenId = "";
    await asUser(s.db, atleta, async () => {
      const res = await s.db.query<{ id: string }>("select id from upsert_order($1)", [registro]);
      ordenId = res.rows[0].id;
    });
    expect(await correos("pago_recibido")).toHaveLength(0);

    await asAdmin(s.db, async () => {
      for (let i = 0; i < 3; i++) {
        await s.db.query(
          "select registrar_intento_de_pago($1, 'mercadopago', 'aprobado', 'MP-1', 200000)",
          [ordenId],
        );
      }
    });

    const filas = await correos("pago_recibido");
    expect(filas).toHaveLength(1);
    expect(filas[0].to_email).toBe("ana@correo.com");
    expect(filas[0].payload).toMatchObject({ total_cents: 200000, currency: "COP" });
    // Y la confirmacion de la inscripcion sale por su propio camino.
    expect(await correos("inscripcion_confirmada")).toHaveLength(1);
  });

  it("una inscripcion sin precio no manda 'pago recibido'", async () => {
    const registro = await empezar(s.divisionId);
    await completarYEnviar(registro);
    expect(await correos("pago_recibido")).toHaveLength(0);
  });
});

describe("colaboradores y jueces", () => {
  it("invitar a un colaborador le manda el correo; postularse no", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select invite_event_staff($1, 'juez.nuevo@correo.com')", [s.eventId]),
    );
    const invitaciones = await correos("invitacion_staff");
    expect(invitaciones).toHaveLength(1);
    expect(invitaciones[0].to_email).toBe("juez.nuevo@correo.com");
    expect(invitaciones[0].payload).toMatchObject({
      has_account: false,
      staff_role: "judge",
      path: "/juez",
    });

    // Postularse (queda sin aprobar) no dispara nada.
    await asUser(s.db, atleta, () => s.db.query("select apply_as_judge('copa-test')"));
    expect(await correos("invitacion_staff")).toHaveLength(1);
    expect(await correos("juez_aprobado")).toHaveLength(0);
  });

  it("aprobar la postulacion avisa al juez, una sola vez", async () => {
    let staffId = "";
    await asUser(s.db, atleta, async () => {
      const res = await s.db.query<{ id: string }>("select id from apply_as_judge('copa-test')");
      staffId = res.rows[0].id;
    });

    await asUser(s.db, s.users.owner, () =>
      s.db.query("select approve_event_staff($1)", [staffId]),
    );
    // Aprobar de nuevo no es una aprobacion nueva.
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select approve_event_staff($1)", [staffId]),
    );

    const filas = await correos("juez_aprobado");
    expect(filas).toHaveLength(1);
    expect(filas[0].to_email).toBe("ana@correo.com");
  });
});

describe("direcciones suprimidas", () => {
  it("no se le encola nada a un correo que rebota", async () => {
    await asAdmin(s.db, () =>
      s.db.query("insert into email_suppressions (email, reason) values ('beto@correo.com', 'bounce_permanente')"),
    );
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await invitar(registro, 2, "beto@correo.com");

    expect(await correos("invitacion_equipo")).toHaveLength(0);
    // El lugar SI quedo reservado: solo cambia que no le escribimos.
    expect(await miembros(registro)).toHaveLength(2);
  });

  it("el capitan ve que lugar quedo sin correo; un tercero no averigua nada", async () => {
    await asAdmin(s.db, () =>
      s.db.query("insert into email_suppressions (email, reason) values ('beto@correo.com', 'queja')"),
    );
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await invitar(registro, 2, "beto@correo.com");

    await asUser(s.db, atleta, async () => {
      const res = await s.db.query<{ member_position: number }>(
        "select member_position from integrantes_con_correo_suprimido($1)",
        [registro],
      );
      expect(res.rows.map((r) => r.member_position)).toEqual([2]);
    });

    await asUser(s.db, s.users.forastero, async () => {
      const res = await s.db.query("select * from integrantes_con_correo_suprimido($1)", [registro]);
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe("limites anti-abuso", () => {
  it("una persona no puede lanzar mas de 30 invitaciones por hora", async () => {
    await asAdmin(s.db, () =>
      s.db.query(
        `insert into email_outbox (kind, to_email, dedupe_key, origen_uid, limitado)
         select 'invitacion_equipo', 'x' || g || '@correo.com', 'relleno:' || g, $1, true
         from generate_series(1, 30) g`,
        [atleta],
      ),
    );
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select invite_member($1, 2, 'beto@correo.com')", [registro])),
    );
    expect(mensaje).toMatch(/muchas invitaciones/i);
  });

  it("una direccion no recibe una lluvia de invitaciones, venga de quien venga", async () => {
    await asAdmin(s.db, () =>
      s.db.query(
        `insert into email_outbox (kind, to_email, dedupe_key, origen_uid, limitado)
         select 'invitacion_equipo', 'beto@correo.com', 'relleno:' || g, gen_random_uuid(), true
         from generate_series(1, 5) g`,
      ),
    );
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select invite_member($1, 2, 'beto@correo.com')", [registro])),
    );
    expect(mensaje).toMatch(/varias invitaciones/i);
  });

  it("los correos de sistema no cuentan contra el limite de la persona", async () => {
    await asAdmin(s.db, () =>
      s.db.query(
        `insert into email_outbox (kind, to_email, dedupe_key, origen_uid, limitado)
         select 'pago_recibido', 'x' || g || '@correo.com', 'sistema:' || g, $1, false
         from generate_series(1, 50) g`,
        [atleta],
      ),
    );
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await invitar(registro, 2, "beto@correo.com");
    expect(await correos("invitacion_equipo")).toHaveLength(1);
  });
});

describe("la cola no es de nadie mas que del servidor", () => {
  it("authenticated no lee ni escribe la cola ni las supresiones", async () => {
    for (const sql of [
      "select * from email_outbox",
      "insert into email_outbox (kind, to_email, dedupe_key) values ('x', 'a@b.com', 'k')",
      "update email_outbox set status = 'enviado'",
      "delete from email_outbox",
      "select * from email_suppressions",
      "insert into email_suppressions (email, reason) values ('a@b.com', 'manual')",
    ]) {
      await asUser(s.db, atleta, () => expectDenied(() => s.db.query(sql)));
    }
  });

  it("anon tampoco", async () => {
    await asAnon(s.db, () => expectDenied(() => s.db.query("select * from email_outbox")));
    await asAnon(s.db, () => expectDenied(() => s.db.query("select * from email_suppressions")));
  });

  it("ningun cliente puede mandar correo llamando a la funcion interna", async () => {
    const llamada = "select interno_encolar_correo('pago_recibido', 'victima@correo.com', '{}'::jsonb, 'k1')";
    await asUser(s.db, atleta, () => expectDenied(() => s.db.query(llamada)));
    await asAnon(s.db, () => expectDenied(() => s.db.query(llamada)));
    await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select * from interno_reclamar_correos(10)")),
    );
    await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select interno_marcar_correo(gen_random_uuid(), true)")),
    );
  });

  it("volver a aplicar la politica de funciones no reabre las internas", async () => {
    await asAdmin(s.db, async () => {
      await s.db.query("select public.apply_function_lockdown()");
      const res = await s.db.query<{ p: boolean }>(
        `select has_function_privilege(
           'authenticated',
           'public.interno_encolar_correo(text, text, jsonb, text, int)',
           'execute'
         ) as p`,
      );
      expect(res.rows[0].p).toBe(false);
    });
  });

  it("service_role si la usa: es el rol con el que corre el procesador", async () => {
    await asAdmin(s.db, async () => {
      await s.db.exec("set role service_role;");
      try {
        const res = await s.db.query("select * from interno_reclamar_correos(10)");
        expect(res.rows).toHaveLength(0);
      } finally {
        await s.db.exec("reset role;");
      }
    });
  });
});

describe("procesar la cola", () => {
  async function encolarUno(): Promise<string> {
    return asAdmin(s.db, async () => {
      const res = await s.db.query<{ id: string }>(
        "select interno_encolar_correo('pago_recibido', 'ana@correo.com', '{}'::jsonb, 'prueba') as id",
      );
      return res.rows[0].id;
    });
  }

  async function reclamar(): Promise<Array<{ id: string; attempts: number; status: string }>> {
    return asAdmin(s.db, async () => {
      const res = await s.db.query<{ id: string; attempts: number; status: string }>(
        "select id, attempts, status from interno_reclamar_correos(10)",
      );
      return res.rows;
    });
  }

  it("reclamar marca 'procesando' y cuenta el intento; nadie lo reclama dos veces", async () => {
    const id = await encolarUno();
    const primero = await reclamar();
    expect(primero).toEqual([{ id, attempts: 1, status: "procesando" }]);
    expect(await reclamar()).toHaveLength(0);
  });

  it("un envio exitoso lo cierra", async () => {
    const id = await encolarUno();
    await reclamar();
    await asAdmin(s.db, () => s.db.query("select interno_marcar_correo($1, true)", [id]));

    const [fila] = await correos();
    expect(fila.status).toBe("enviado");
  });

  it("un fallo lo reagenda con espera y no se reclama antes de tiempo", async () => {
    const id = await encolarUno();
    await reclamar();
    await asAdmin(s.db, () =>
      s.db.query("select interno_marcar_correo($1, false, 'proveedor caido')", [id]),
    );

    const [fila] = await correos();
    expect(fila.status).toBe("pendiente");
    expect(await reclamar()).toHaveLength(0);

    // Cuando llega su hora, vuelve a salir.
    await asAdmin(s.db, () =>
      s.db.query("update email_outbox set next_attempt_at = now() - interval '1 second' where id = $1", [id]),
    );
    const otra = await reclamar();
    expect(otra[0].attempts).toBe(2);
  });

  it("al quinto fallo se da por perdido y deja el motivo", async () => {
    const id = await encolarUno();
    for (let i = 1; i <= 5; i++) {
      const filas = await reclamar();
      expect(filas[0].attempts).toBe(i);
      await asAdmin(s.db, () =>
        s.db.query("select interno_marcar_correo($1, false, 'sigue caido')", [id]),
      );
      await asAdmin(s.db, () =>
        s.db.query("update email_outbox set next_attempt_at = now() - interval '1 second' where id = $1", [id]),
      );
    }

    const res = await asAdmin(s.db, () =>
      s.db.query<{ status: string; last_error: string }>(
        "select status, last_error from email_outbox where id = $1",
        [id],
      ),
    );
    expect(res.rows[0]).toEqual({ status: "fallido", last_error: "sigue caido" });
    expect(await reclamar()).toHaveLength(0);
  });

  it("un worker que murio a mitad de envio no deja el correo huerfano", async () => {
    const id = await encolarUno();
    await reclamar();
    await asAdmin(s.db, () =>
      s.db.query("update email_outbox set locked_at = now() - interval '10 minutes' where id = $1", [id]),
    );
    const otra = await reclamar();
    expect(otra).toHaveLength(1);
    expect(otra[0].attempts).toBe(2);
  });
});

describe("idioma del perfil", () => {
  it("se toma del metadata al crear la cuenta, y un valor invalido queda vacio", async () => {
    await asAdmin(s.db, async () => {
      await s.db.query(
        "insert into auth.users (email, raw_user_meta_data) values ('br@correo.com', '{\"locale\":\"pt\"}'::jsonb)",
      );
      await s.db.query(
        "insert into auth.users (email, raw_user_meta_data) values ('xx@correo.com', '{\"locale\":\"klingon\"}'::jsonb)",
      );
      const res = await s.db.query<{ email: string; locale: string | null }>(
        "select email, locale from profiles where email in ('br@correo.com','xx@correo.com') order by email",
      );
      expect(res.rows).toEqual([
        { email: "br@correo.com", locale: "pt" },
        { email: "xx@correo.com", locale: null },
      ]);
    });
  });
});
