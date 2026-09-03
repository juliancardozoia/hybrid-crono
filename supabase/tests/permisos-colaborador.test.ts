/**
 * Permisos finos de colaborador, y alcance por categoría.
 *
 * El rol solo —manager > verifier > scorekeeper > registrar > judge— sirve
 * mientras la gente entre en cinco casilleros. Deja de servir en cuanto aparece
 * el sexto: "puede cargar scores pero no borrar registros", que es el reparto
 * real de una competencia con quince voluntarios.
 *
 * Lo que se verifica acá es que los permisos SUMAN sobre el rol sin ascender a
 * nadie: un juez con `can_edit_scores` puede puntuar, y sigue sin poder publicar.
 * Ascenderlo a `scorekeeper` le daría de paso todo lo que ese rol arrastra.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asUser, createUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;
let colaborador: string;

beforeEach(async () => {
  s = await seedScenario();
  colaborador = await createUser(s.db, "colabora@box.com", "Cami Colabora");
});

/** Invita con los permisos que se le pasen, como lo hace la pantalla. */
async function invitar(permisos: Partial<{
  isAdmin: boolean;
  editaRegistros: boolean;
  borraRegistros: boolean;
  editaScores: boolean;
  gestionaWorkouts: boolean;
  divisiones: string[];
}> = {}) {
  await asUser(s.db, s.users.owner, () =>
    s.db.query(
      `select invite_event_staff($1, 'colabora@box.com', 'judge', $2, $3, $4, $5, $6, $7)`,
      [
        s.eventId,
        permisos.isAdmin ?? false,
        permisos.editaRegistros ?? false,
        permisos.borraRegistros ?? false,
        permisos.editaScores ?? false,
        permisos.gestionaWorkouts ?? false,
        permisos.divisiones ?? null,
      ],
    ),
  );
}

async function puede(fn: string, args: unknown[] = [s.eventId]): Promise<boolean> {
  return asUser(s.db, colaborador, async () => {
    const res = await s.db.query<{ ok: boolean }>(
      `select ${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as ok`,
      args,
    );
    return res.rows[0].ok;
  });
}

describe("los permisos suman sobre el rol", () => {
  it("sin nada marcado es un juez: no puntúa ni inscribe", async () => {
    await invitar();
    expect(await puede("can_score_event")).toBe(false);
    expect(await puede("can_register_event")).toBe(false);
    expect(await puede("can_manage_workouts")).toBe(false);
  });

  it("un juez con permiso de scores puntúa, y sigue sin poder verificar", async () => {
    // El punto entero de los permisos finos: no hay que ascenderlo a
    // `scorekeeper` y darle de paso todo lo que ese rol arrastra.
    await invitar({ editaScores: true });
    expect(await puede("can_score_event")).toBe(true);
    expect(await puede("can_verify_event")).toBe(false);
    expect(await puede("can_manage_event")).toBe(false);
  });

  it("editar registros no es borrarlos", async () => {
    // Quien corrige el dorsal mal escrito de un atleta no tiene por qué poder
    // eliminarlo de la competencia.
    await invitar({ editaRegistros: true });
    expect(await puede("can_register_event")).toBe(true);
    expect(await puede("can_delete_registrations")).toBe(false);
  });

  it("borrar registros se da aparte", async () => {
    await invitar({ borraRegistros: true });
    expect(await puede("can_delete_registrations")).toBe(true);
  });

  it("cargar workouts es su propio permiso", async () => {
    await invitar({ gestionaWorkouts: true });
    expect(await puede("can_manage_workouts")).toBe(true);
    expect(await puede("can_score_event")).toBe(false);
  });
});

describe("administrador", () => {
  it("puede todo, sin marcar ningún permiso individual", async () => {
    await invitar({ isAdmin: true });
    expect(await puede("can_manage_event")).toBe(true);
    expect(await puede("can_score_event")).toBe(true);
    expect(await puede("can_register_event")).toBe(true);
    expect(await puede("can_delete_registrations")).toBe(true);
    expect(await puede("can_manage_workouts")).toBe(true);
  });

  it("queda con rol manager aunque se lo invite como juez", async () => {
    await invitar({ isAdmin: true });
    const res = await asAdmin(s.db, () =>
      s.db.query<{ role: string }>(
        "select role from event_staff where event_id = $1 and invited_email = 'colabora@box.com'",
        [s.eventId],
      ),
    );
    expect(res.rows[0].role).toBe("manager");
  });
});

describe("alcance por categoría", () => {
  it("sin filas de alcance, puede con todas", async () => {
    // Vacío = todas. Es lo que hace que el caso común no necesite configuración.
    await invitar({ editaScores: true });
    expect(await puede("puede_en_division", [s.eventId, s.divisionId])).toBe(true);
  });

  it("con una categoría elegida, no puede con las demás", async () => {
    const otra = await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Otra categoría', 1, 'female',
                 (select course_template_id from divisions where id = $2))
         returning id`,
        [s.eventId, s.divisionId],
      );
      return res.rows[0].id;
    });

    await invitar({ editaScores: true, divisiones: [s.divisionId] });

    expect(await puede("puede_en_division", [s.eventId, s.divisionId])).toBe(true);
    expect(await puede("puede_en_division", [s.eventId, otra])).toBe(false);
  });

  it("un administrador nunca queda acotado", async () => {
    await invitar({ isAdmin: true, divisiones: [s.divisionId] });
    const res = await asAdmin(s.db, () =>
      s.db.query<{ n: number }>(
        `select count(*)::int as n from event_staff_divisions d
         join event_staff s on s.id = d.staff_id
         where s.event_id = $1`,
        [s.eventId],
      ),
    );
    // Ni siquiera se guardan: un administrador con alcance limitado sería un
    // administrador que no puede hacer algo, y eso no es un administrador.
    expect(res.rows[0].n).toBe(0);
  });

  it("editar el alcance lo REEMPLAZA, no lo acumula", async () => {
    await invitar({ editaScores: true, divisiones: [s.divisionId] });
    await invitar({ editaScores: true });

    const res = await asAdmin(s.db, () =>
      s.db.query<{ n: number }>(
        `select count(*)::int as n from event_staff_divisions d
         join event_staff s on s.id = d.staff_id
         where s.event_id = $1`,
        [s.eventId],
      ),
    );
    // Quitarle una categoría tiene que quitársela de verdad.
    expect(res.rows[0].n).toBe(0);
  });
});

describe("quién puede invitar", () => {
  it("un juez no invita colaboradores", async () => {
    await asUser(s.db, s.users.judgeA, () =>
      expectDenied(() =>
        s.db.query("select invite_event_staff($1, 'otro@box.com')", [s.eventId]),
      ),
    );
  });

  it("el alcance no se escribe a mano: la tabla no tiene insert", async () => {
    // Misma jugada que hace inmutable a `timing_events`: la garantía es un
    // privilegio ausente, no una política presente.
    await invitar({ editaScores: true });
    await asUser(s.db, colaborador, () =>
      expectDenied(() =>
        s.db.query(
          `insert into event_staff_divisions (staff_id, division_id, event_id)
           values ((select id from event_staff where event_id = $1 limit 1), $2, $1)`,
          [s.eventId, s.divisionId],
        ),
      ),
    );
  });
});

describe("reusar jueces de otras competencias", () => {
  it("ofrece a quien ya trabajó en otro evento de la organización", async () => {
    // El costo real de invitar por evento es la carga administrativa: un box
    // que hace una fecha por mes con los mismos doce jueces tendría que
    // escribir doce correos cada vez. Esta función es el recuerdo.
    await invitar();

    const otro = await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ id: string }>(
        `insert into events (org_id, name, public_slug, status)
         values ($1, 'Segunda Copa', 'segunda-copa', 'draft') returning id`,
        [s.orgId],
      );
      return res.rows[0].id;
    });

    const lista = await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ email: string; veces: string; fue_juez: boolean }>(
        "select email, veces, fue_juez from org_staff_directory($1)",
        [otro],
      );
      return res.rows;
    });

    expect(lista).toHaveLength(1);
    expect(lista[0].email).toBe("colabora@box.com");
    expect(lista[0].fue_juez).toBe(true);
  });

  it("no ofrece a quien YA está en este evento", async () => {
    // Una fila que no hace nada y que igual hay que leer.
    await invitar();
    const lista = await asUser(s.db, s.users.owner, () =>
      s.db.query("select * from org_staff_directory($1)", [s.eventId]),
    );
    expect(lista.rows).toHaveLength(0);
  });

  it("un juez no ve el directorio de la organización", async () => {
    // Es el historial de contactos de la organización, no una lista pública.
    await invitar();
    const lista = await asUser(s.db, colaborador, () =>
      s.db.query("select * from org_staff_directory($1)", [s.eventId]),
    );
    expect(lista.rows).toHaveLength(0);
  });
});
