/**
 * Inscripciones.
 *
 * Lo que más importa acá es la frontera: una inscripción NO es un equipo. El
 * trámite puede quedar a medias para siempre; el equipo existe solo si llegó a
 * buen puerto. Confirmar es lo único que materializa athletes, teams y
 * team_members — y por eso el resto del sistema no se entera de que las
 * inscripciones existen.
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

  await asAdmin(s.db, async () => {
    await s.db.query(
      `update events set starts_at = now() + interval '30 days',
         registration_opens_at = now() - interval '1 day',
         registration_closes_at = now() + interval '20 days',
         shirt_sizes = array['S','M','L'],
         published_at = now()
       where id = $1`,
      [s.eventId],
    );
  });

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

async function empezar(divisionId: string, usuario = atleta, nombre?: string): Promise<string> {
  let id = "";
  await asUser(s.db, usuario, async () => {
    const res = await s.db.query<{ id: string }>(
      "select id from start_registration($1, $2)",
      [divisionId, nombre ?? null],
    );
    id = res.rows[0].id;
  });
  return id;
}

const DATOS_OK = {
  firstName: "Ana",
  lastName: "Pérez",
  gender: "female",
  shirtSize: "M",
  acceptTerms: true,
};

async function completar(
  usuario: string,
  memberId: string,
  datos: Record<string, unknown> = DATOS_OK,
): Promise<void> {
  await asUser(s.db, usuario, () =>
    s.db.query("select save_member_data($1, $2::jsonb)", [memberId, JSON.stringify(datos)]),
  );
}

async function integrantes(registrationId: string, usuario = atleta) {
  let filas: Array<{ id: string; position: number; status: string; invited_email: string; profile_id: string | null }> =
    [];
  await asUser(s.db, usuario, async () => {
    const res = await s.db.query<(typeof filas)[number]>(
      "select id, position, status, invited_email, profile_id from registration_members where registration_id = $1 order by position",
      [registrationId],
    );
    filas = res.rows;
  });
  return filas;
}

describe("empezar una inscripción", () => {
  it("el atleta elige categoría y queda como primer integrante", async () => {
    const id = await empezar(s.divisionId);
    const filas = await integrantes(id);

    expect(filas).toHaveLength(1);
    expect(filas[0].position).toBe(1);
    expect(filas[0].invited_email).toBe("ana@correo.com");
    expect(filas[0].profile_id).toBe(atleta);
  });

  it("una categoría individual arranca en borrador y una de parejas esperando integrantes", async () => {
    await asUser(s.db, atleta, async () => {
      const individual = await s.db.query<{ status: string }>(
        "select status from start_registration($1)",
        [s.divisionId],
      );
      expect(individual.rows[0].status).toBe("borrador");

      const parejas = await s.db.query<{ status: string }>(
        "select status from start_registration($1, 'Los Fuertes')",
        [divisionParejas],
      );
      expect(parejas.rows[0].status).toBe("esperando_integrantes");
    });
  });

  it("sin cuenta no se puede empezar", async () => {
    await asAnon(s.db, () =>
      expectDenied(() => s.db.query("select start_registration($1)", [s.divisionId])),
    );
  });

  it("no se puede uno inscribir dos veces en la misma categoría", async () => {
    await empezar(s.divisionId);
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select start_registration($1)", [s.divisionId])),
    );
    expect(mensaje).toMatch(/ya ten/i);
  });

  it("una competencia sin publicar no recibe inscripciones por el portal", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set published_at = null where id = $1", [s.eventId]),
    );
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select start_registration($1)", [s.divisionId])),
    );
    expect(mensaje).toMatch(/todavía no abrió/i);
  });

  it("pero la organización sí puede anotar gente a mano en una competencia interna", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set published_at = null where id = $1", [s.eventId]),
    );
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select start_registration($1)", [s.divisionId]),
    );
  });

  it("con las inscripciones cerradas no se puede empezar", async () => {
    await asAdmin(s.db, () =>
      s.db.query(
        "update events set registration_closes_at = now() - interval '1 hour' where id = $1",
        [s.eventId],
      ),
    );
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select start_registration($1)", [s.divisionId])),
    );
    expect(mensaje).toMatch(/cerradas/i);
  });

  it("la ventana de la categoría manda sobre la del evento", async () => {
    // Sirve para abrir Elite antes que Open, o para cerrar una categoría llena.
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        `insert into division_registration (division_id, event_id, opens_at)
         values ($1, $2, now() + interval '5 days')`,
        [s.divisionId, s.eventId],
      ),
    );
    await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select start_registration($1)", [s.divisionId])),
    );
  });
});

describe("cupos", () => {
  beforeEach(async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        "insert into division_registration (division_id, event_id, capacity) values ($1, $2, 1)",
        [s.divisionId, s.eventId],
      ),
    );
  });

  it("con el cupo lleno, el siguiente no entra", async () => {
    const id = await empezar(s.divisionId);
    const [capitan] = await integrantes(id);
    await completar(atleta, capitan.id);
    await asUser(s.db, atleta, () => s.db.query("select submit_registration($1)", [id]));

    const mensaje = await asUser(s.db, companero, () =>
      expectDenied(() => s.db.query("select start_registration($1)", [s.divisionId])),
    );
    expect(mensaje).toMatch(/cupos/i);
  });

  it("una inscripción cancelada libera el cupo", async () => {
    const id = await empezar(s.divisionId);
    const [capitan] = await integrantes(id);
    await completar(atleta, capitan.id);
    await asUser(s.db, atleta, () => s.db.query("select submit_registration($1)", [id]));
    await asUser(s.db, atleta, () => s.db.query("select cancel_registration($1)", [id]));

    await asUser(s.db, companero, () =>
      s.db.query("select start_registration($1)", [s.divisionId]),
    );
  });
});

describe("equipos: invitar y reclamar", () => {
  let registro: string;

  beforeEach(async () => {
    registro = await empezar(divisionParejas, atleta, "Los Fuertes");
  });

  it("el capitán invita por correo real", async () => {
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [registro, "Beto@Correo.com"]),
    );

    const filas = await integrantes(registro);
    expect(filas).toHaveLength(2);
    // El correo se normaliza: si no, "Beto@" y "beto@" serian dos personas.
    expect(filas[1].invited_email).toBe("beto@correo.com");
    // Como ya tiene cuenta, queda enlazado de una.
    expect(filas[1].profile_id).toBe(companero);
  });

  it("un correo sin cuenta queda pendiente hasta que la persona entra", async () => {
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [registro, "nuevo@correo.com"]),
    );
    expect((await integrantes(registro))[1].profile_id).toBeNull();

    const nuevo = await createUser(s.db, "nuevo@correo.com");
    await asUser(s.db, nuevo, () =>
      s.db.query("select claim_membership($1)", [registro]),
    );

    expect((await integrantes(registro))[1].profile_id).toBe(nuevo);
  });

  it("nadie reclama un lugar que no es suyo", async () => {
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [registro, "beto@correo.com"]),
    );

    const intruso = await createUser(s.db, "intruso@correo.com");
    await asUser(s.db, intruso, () => s.db.query("select claim_membership($1)", [registro]));

    // Sigue siendo de Beto.
    expect((await integrantes(registro))[1].profile_id).toBe(companero);
  });

  it("no se puede invitar más allá del tamaño del equipo", async () => {
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() =>
        s.db.query("select invite_member($1, 3, $2)", [registro, "tercero@correo.com"]),
      ),
    );
    expect(mensaje).toMatch(/2 integrante/i);
  });

  it("el mismo correo no puede ocupar dos lugares", async () => {
    await asUser(s.db, atleta, () =>
      expectDenied(() =>
        s.db.query("select invite_member($1, 2, $2)", [registro, "ana@correo.com"]),
      ),
    );
  });

  it("solo el capitán invita", async () => {
    await asUser(s.db, companero, () =>
      expectDenied(() =>
        s.db.query("select invite_member($1, 2, $2)", [registro, "otro@correo.com"]),
      ),
    );
  });

  it("cambiar de integrante borra los datos del anterior", async () => {
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [registro, "beto@correo.com"]),
    );
    const [, beto] = await integrantes(registro);
    await completar(companero, beto.id, { ...DATOS_OK, firstName: "Beto", lastName: "Gómez" });
    expect((await integrantes(registro))[1].status).toBe("completo");

    // Los datos del que se fue no son del que entra.
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [registro, "otro@correo.com"]),
    );
    const filas = await integrantes(registro);
    expect(filas[1].status).toBe("invitado");
    expect(filas[1].invited_email).toBe("otro@correo.com");
  });
});

describe("completar los datos", () => {
  let registro: string;
  let capitan: string;

  beforeEach(async () => {
    registro = await empezar(s.divisionId);
    capitan = (await integrantes(registro))[0].id;
  });

  it("con nombre, apellido y términos aceptados, queda completo", async () => {
    await completar(atleta, capitan);
    expect((await integrantes(registro))[0].status).toBe("completo");
  });

  it("sin aceptar los términos NO queda completo", async () => {
    await completar(atleta, capitan, { ...DATOS_OK, acceptTerms: false });
    expect((await integrantes(registro))[0].status).toBe("invitado");
  });

  it("sin apellido tampoco", async () => {
    await completar(atleta, capitan, { ...DATOS_OK, lastName: "" });
    expect((await integrantes(registro))[0].status).toBe("invitado");
  });

  it("la talla tiene que ser una de las que ofrece el evento", async () => {
    // Sin este chequeo entra cualquier texto y el organizador termina con "L",
    // "l" y "Large".
    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() =>
        s.db.query("select save_member_data($1, $2::jsonb)", [
          capitan,
          JSON.stringify({ ...DATOS_OK, shirtSize: "XXXL" }),
        ]),
      ),
    );
    expect(mensaje).toMatch(/talla/i);
  });

  it("un evento sin tallas no valida ninguna", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set shirt_sizes = '{}' where id = $1", [s.eventId]),
    );
    await completar(atleta, capitan, { ...DATOS_OK, shirtSize: "" });
  });

  it("nadie edita los datos de otro", async () => {
    await asUser(s.db, companero, () =>
      expectDenied(() =>
        s.db.query("select save_member_data($1, $2::jsonb)", [capitan, JSON.stringify(DATOS_OK)]),
      ),
    );
  });

  it("pero el capitán sí puede cargar por un compañero que no abre el link", async () => {
    const equipo = await empezar(divisionParejas, atleta, "Los Fuertes");
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [equipo, "beto@correo.com"]),
    );
    const [, beto] = await integrantes(equipo);
    await completar(atleta, beto.id, { ...DATOS_OK, firstName: "Beto", lastName: "Gómez" });
    expect((await integrantes(equipo))[1].status).toBe("completo");
  });
});

describe("confirmar: acá nace el equipo", () => {
  it("una inscripción sin precio se confirma sola al enviarla", async () => {
    // Es lo que hace que el plan gratuito sirva de punta a punta sin pasarelas.
    const registro = await empezar(s.divisionId);
    const [capitan] = await integrantes(registro);
    await completar(atleta, capitan.id);

    await asUser(s.db, atleta, async () => {
      const res = await s.db.query<{ status: string; team_id: string | null }>(
        "select status, team_id from submit_registration($1)",
        [registro],
      );
      expect(res.rows[0].status).toBe("confirmada");
      expect(res.rows[0].team_id).not.toBeNull();
    });
  });

  it("con precio queda esperando pago y NO crea el equipo", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        "insert into division_registration (division_id, event_id, price_cents) values ($1, $2, 150000)",
        [s.divisionId, s.eventId],
      ),
    );

    const registro = await empezar(s.divisionId);
    const [capitan] = await integrantes(registro);
    await completar(atleta, capitan.id);

    await asUser(s.db, atleta, async () => {
      const res = await s.db.query<{ status: string; team_id: string | null; price_cents: number }>(
        "select status, team_id, price_cents from submit_registration($1)",
        [registro],
      );
      expect(res.rows[0].status).toBe("esperando_pago");
      expect(res.rows[0].team_id).toBeNull();
      // El precio se congeló al empezar el trámite.
      expect(res.rows[0].price_cents).toBe(150000);
    });
  });

  it("materializa athletes, teams y team_members con dorsal", async () => {
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [registro, "beto@correo.com"]),
    );
    const filas = await integrantes(registro);
    await completar(atleta, filas[0].id);
    await completar(companero, filas[1].id, {
      ...DATOS_OK,
      firstName: "Beto",
      lastName: "Gómez",
      gender: "male",
    });

    await asUser(s.db, atleta, () => s.db.query("select submit_registration($1)", [registro]));

    await asUser(s.db, s.users.owner, async () => {
      const equipo = await s.db.query<{ id: string; name: string; bib_number: number }>(
        `select t.id, t.name, t.bib_number from teams t
         join registrations r on r.team_id = t.id where r.id = $1`,
        [registro],
      );
      expect(equipo.rows[0].name).toBe("Los Fuertes");
      expect(equipo.rows[0].bib_number).toBeGreaterThan(0);

      const miembros = await s.db.query<{ first_name: string; profile_id: string | null }>(
        `select a.first_name, a.profile_id from team_members tm
         join athletes a on a.id = tm.athlete_id
         where tm.team_id = $1 order by a.first_name`,
        [equipo.rows[0].id],
      );
      expect(miembros.rows.map((m) => m.first_name)).toEqual(["Ana", "Beto"]);
      // El atleta del evento queda enlazado con la cuenta que se inscribió.
      expect(miembros.rows.every((m) => m.profile_id !== null)).toBe(true);
    });
  });

  it("no se confirma con un integrante a medias", async () => {
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [registro, "beto@correo.com"]),
    );
    const filas = await integrantes(registro);
    await completar(atleta, filas[0].id);

    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select submit_registration($1)", [registro])),
    );
    expect(mensaje).toMatch(/complete sus datos/i);
  });

  it("no se confirma un equipo incompleto", async () => {
    const registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    const [capitan] = await integrantes(registro);
    await completar(atleta, capitan.id);

    const mensaje = await asUser(s.db, atleta, () =>
      expectDenied(() => s.db.query("select confirm_registration($1)", [registro])),
    );
    expect(mensaje).toMatch(/2 integrante/i);
  });

  it("confirmar dos veces no crea dos equipos", async () => {
    // Un webhook de pago que llega repetido es lo normal, no la excepción.
    const registro = await empezar(s.divisionId);
    const [capitan] = await integrantes(registro);
    await completar(atleta, capitan.id);
    await asUser(s.db, atleta, () => s.db.query("select submit_registration($1)", [registro]));

    await asUser(s.db, atleta, () => s.db.query("select confirm_registration($1)", [registro]));
    await asUser(s.db, atleta, () => s.db.query("select confirm_registration($1)", [registro]));

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from teams where event_id = $1 and name is not distinct from null and bib_number > 103",
        [s.eventId],
      );
      expect(res.rows[0].n).toBe(1);
    });
  });

  it("cancelar retira el equipo en vez de borrarlo", async () => {
    const registro = await empezar(s.divisionId);
    const [capitan] = await integrantes(registro);
    await completar(atleta, capitan.id);
    await asUser(s.db, atleta, () => s.db.query("select submit_registration($1)", [registro]));
    await asUser(s.db, atleta, () => s.db.query("select cancel_registration($1)", [registro]));

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ status: string }>(
        `select t.status from teams t join registrations r on r.team_id = t.id where r.id = $1`,
        [registro],
      );
      // El equipo no se borra: se retira, para que sus tiempos —si llegó a
      // correr— no desaparezcan.
      expect(res.rows[0].status).toBe("withdrawn");
    });
  });
});

describe("quién ve qué", () => {
  let registro: string;

  beforeEach(async () => {
    registro = await empezar(divisionParejas, atleta, "Los Fuertes");
    await asUser(s.db, atleta, () =>
      s.db.query("select invite_member($1, 2, $2)", [registro, "beto@correo.com"]),
    );
  });

  it("el capitán y el invitado la ven", async () => {
    for (const usuario of [atleta, companero]) {
      await asUser(s.db, usuario, async () => {
        const res = await s.db.query("select id from registrations where id = $1", [registro]);
        expect(res.rows).toHaveLength(1);
      });
    }
  });

  it("la organización ve todas las de su evento", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query("select id from registrations where event_id = $1", [
        s.eventId,
      ]);
      expect(res.rows).toHaveLength(1);
    });
  });

  it("un tercero no ve nada", async () => {
    const tercero = await createUser(s.db, "tercero@correo.com");
    await asUser(s.db, tercero, async () => {
      const res = await s.db.query("select id from registrations");
      expect(res.rows).toEqual([]);
      const miembros = await s.db.query("select id from registration_members");
      expect(miembros.rows).toEqual([]);
    });
  });

  it("el anónimo ni siquiera puede preguntar", async () => {
    await asAnon(s.db, async () => {
      await expectDenied(() => s.db.query("select * from registrations"));
      await expectDenied(() => s.db.query("select * from registration_members"));
    });
  });

  it("nadie escribe las tablas directamente", async () => {
    // La garantía es un privilegio ausente, no una política presente.
    await asUser(s.db, atleta, async () => {
      await expectDenied(() =>
        s.db.query("update registrations set status = 'confirmada' where id = $1", [registro]),
      );
      await expectDenied(() =>
        s.db.query("update registration_members set status = 'completo' where registration_id = $1", [
          registro,
        ]),
      );
    });
  });
});

describe("el formulario público", () => {
  it("lo puede pedir cualquiera: es el formulario en blanco", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        "insert into division_registration (division_id, event_id, price_cents, capacity) values ($1, $2, 120000, 40)",
        [s.divisionId, s.eventId],
      ),
    );

    await asAnon(s.db, async () => {
      const res = await s.db.query<{
        public_registration_form: {
          name: string;
          abierta: boolean;
          shirtSizes: string[];
          divisions: Array<{ name: string; priceCents: number | null; cuposDisponibles: number | null }>;
        };
      }>("select public_registration_form($1)", ["copa-test"]);

      const form = res.rows[0].public_registration_form;
      expect(form.name).toBe("Copa Test");
      expect(form.abierta).toBe(true);
      expect(form.shirtSizes).toEqual(["S", "M", "L"]);

      const rx = form.divisions.find((d) => d.name === "Individual Masculino RX");
      expect(rx?.priceCents).toBe(120000);
      expect(rx?.cuposDisponibles).toBe(40);
    });
  });

  it("una competencia sin publicar no tiene formulario", async () => {
    await asAdmin(s.db, () =>
      s.db.query("update events set published_at = null where id = $1", [s.eventId]),
    );
    await asAnon(s.db, async () => {
      const res = await s.db.query<{ public_registration_form: unknown }>(
        "select public_registration_form($1)",
        ["copa-test"],
      );
      expect(res.rows[0].public_registration_form).toBeNull();
    });
  });
});

describe("admin_create_registration: el alta manual", () => {
  it("crea el equipo YA confirmado, sin pedir pago, aunque la categoría tenga precio", async () => {
    await asUser(s.db, s.users.owner, () =>
      s.db.query(
        "insert into division_registration (division_id, event_id, price_cents) values ($1, $2, 150000)",
        [s.divisionId, s.eventId],
      ),
    );

    const integrante = {
      firstName: "Carla",
      lastName: "Ruiz",
      email: "carla@correo.com",
      birthDate: "1994-05-01",
      gender: "female",
      country: "CO",
      documentId: "1020304050",
      stateProvince: "Antioquia",
    };

    let equipo: { id: string; bib_number: number } | undefined;
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ id: string; bib_number: number }>(
        "select id, bib_number from admin_create_registration($1, $2, $3::jsonb)",
        [s.divisionId, null, JSON.stringify([integrante])],
      );
      equipo = res.rows[0];
    });

    expect(equipo?.id).toBeTruthy();
    expect(equipo?.bib_number).toBeGreaterThan(0);

    await asUser(s.db, s.users.owner, async () => {
      const atletas = await s.db.query<{
        first_name: string;
        country: string;
        document_id: string;
        state_province: string;
        email: string;
      }>(
        `select a.first_name, a.country, a.document_id, a.state_province, a.email
         from athletes a join team_members tm on tm.athlete_id = a.id
         where tm.team_id = $1`,
        [equipo!.id],
      );
      expect(atletas.rows).toHaveLength(1);
      expect(atletas.rows[0]).toMatchObject({
        first_name: "Carla",
        country: "CO",
        document_id: "1020304050",
        state_province: "Antioquia",
        email: "carla@correo.com",
      });

      // Aunque la categoria tiene precio, el alta manual no genera una orden
      // ni deja el tramite esperando pago: queda confirmada directo.
      const registro = await s.db.query<{ status: string }>(
        "select status from registrations where team_id = $1",
        [equipo!.id],
      );
      expect(registro.rows[0].status).toBe("confirmada");
    });
  });

  it("da de alta un equipo completo de una sola vez", async () => {
    const integrantes = [
      { firstName: "Uno", lastName: "A", email: "uno@correo.com", gender: "male" },
      { firstName: "Dos", lastName: "B", email: "dos@correo.com", gender: "female" },
    ];

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ id: string }>(
        "select id from admin_create_registration($1, $2, $3::jsonb)",
        [divisionParejas, "Los Manuales", JSON.stringify(integrantes)],
      );
      const atletas = await s.db.query<{ first_name: string }>(
        `select a.first_name from athletes a join team_members tm on tm.athlete_id = a.id
         where tm.team_id = $1 order by a.first_name`,
        [res.rows[0].id],
      );
      expect(atletas.rows.map((r) => r.first_name)).toEqual(["Dos", "Uno"]);
    });
  });

  it("rechaza si la cantidad de integrantes no coincide con el tamaño de la categoría", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await expect(
        s.db.query(
          "select admin_create_registration($1, $2, $3::jsonb)",
          [divisionParejas, null, JSON.stringify([{ firstName: "Solo", lastName: "Uno", email: "solo@correo.com" }])],
        ),
      ).rejects.toThrow(/integrante/i);
    });
  });

  it("un forastero no puede dar de alta atletas", async () => {
    await asUser(s.db, s.users.forastero, () =>
      expectDenied(() =>
        s.db.query(
          "select admin_create_registration($1, $2, $3::jsonb)",
          [
            s.divisionId,
            null,
            JSON.stringify([{ firstName: "X", lastName: "Y", email: "x@correo.com" }]),
          ],
        ),
      ),
    );
  });
});
