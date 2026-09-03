/**
 * Arenas, cronograma y colaboradores.
 *
 * Lo que más importa acá: un colaborador tiene acceso a UN evento, no a la
 * organización entera; y el cronograma detecta lo que de verdad arruina un día
 * de competencia — dos heats pisándose, un juez en dos lugares, un atleta con
 * dos pruebas simultáneas.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAnon, asUser, createUser, expectDenied } from "./harness";
import { asignarJueces, seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

async function crearArena(nombre: string, minutos = 15): Promise<string> {
  let id = "";
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ id: string }>(
      "insert into arenas (event_id, name, default_heat_minutes) values ($1, $2, $3) returning id",
      [s.eventId, nombre, minutos],
    );
    id = res.rows[0].id;
  });
  return id;
}

async function issues(): Promise<Array<{ severity: string; code: string; detail: string }>> {
  let filas: Array<{ severity: string; code: string; detail: string }> = [];
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<(typeof filas)[number]>(
      "select severity, code, detail from event_schedule_issues($1)",
      [s.eventId],
    );
    filas = res.rows;
  });
  return filas;
}

const codigos = (filas: Array<{ code: string }>) => filas.map((f) => f.code);

describe("arenas", () => {
  it("el organizador las crea y quedan ordenadas", async () => {
    await crearArena("Pista", 15);
    await crearArena("Piscina", 30);

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ name: string }>(
        "select name from arenas where event_id = $1 order by name",
        [s.eventId],
      );
      expect(res.rows.map((r) => r.name)).toEqual(["Piscina", "Pista"]);
    });
  });

  it("no se repite el nombre dentro del mismo evento", async () => {
    await crearArena("Pista");
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query("insert into arenas (event_id, name) values ($1, 'Pista')", [s.eventId]),
      ),
    );
  });

  it("borrar una arena deja los heats sin arena, no los borra", async () => {
    // La FK compuesta con SET NULL acotado: sin acotarla anularía también
    // event_id, que es NOT NULL.
    const arena = await crearArena("Pista");
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("update heats set arena_id = $1 where id = $2", [arena, s.heatId]);
      await s.db.query("delete from arenas where id = $1", [arena]);

      const res = await s.db.query<{ arena_id: string | null; event_id: string }>(
        "select arena_id, event_id from heats where id = $1",
        [s.heatId],
      );
      expect(res.rows[0].arena_id).toBeNull();
      expect(res.rows[0].event_id).toBe(s.eventId);
    });
  });

  it("un heat no puede terminar antes de empezar", async () => {
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query(
          "update heats set scheduled_at = now(), scheduled_end_at = now() - interval '1 hour' where id = $1",
          [s.heatId],
        ),
      ),
    );
  });
});

describe("conflictos del cronograma", () => {
  it("un evento sin horarios avisa que faltan, sin llamarlo error", async () => {
    const filas = await issues();
    expect(codigos(filas)).toContain("heat_sin_horario");
    expect(filas.find((f) => f.code === "heat_sin_horario")?.severity).toBe("warning");
  });

  it("detecta dos heats pisándose en la misma arena", async () => {
    const arena = await crearArena("Pista", 30);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "update heats set arena_id = $1, scheduled_at = '2026-05-01 10:00-05' where id = $2",
        [arena, s.heatId],
      );
      await s.db.query(
        `insert into heats (event_id, name, lane_count, arena_id, scheduled_at)
         values ($1, 'Heat 2', 6, $2, '2026-05-01 10:15-05')`,
        [s.eventId, arena],
      );
    });

    expect(codigos(await issues())).toContain("arena_solapada");
  });

  it("dos heats seguidos en la misma arena NO se pisan", async () => {
    const arena = await crearArena("Pista", 30);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "update heats set arena_id = $1, scheduled_at = '2026-05-01 10:00-05' where id = $2",
        [arena, s.heatId],
      );
      await s.db.query(
        `insert into heats (event_id, name, lane_count, arena_id, scheduled_at)
         values ($1, 'Heat 2', 6, $2, '2026-05-01 10:30-05')`,
        [s.eventId, arena],
      );
    });

    expect(codigos(await issues())).not.toContain("arena_solapada");
  });

  it("dos arenas distintas a la misma hora es lo normal, no un conflicto", async () => {
    // Es justo lo que hace un CrossFit: varias pruebas en simultáneo.
    const pista = await crearArena("Pista", 30);
    const piscina = await crearArena("Piscina", 30);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "update heats set arena_id = $1, scheduled_at = '2026-05-01 10:00-05' where id = $2",
        [pista, s.heatId],
      );
      await s.db.query(
        `insert into heats (event_id, name, lane_count, arena_id, scheduled_at)
         values ($1, 'Heat 2', 6, $2, '2026-05-01 10:00-05')`,
        [s.eventId, piscina],
      );
    });

    expect(codigos(await issues())).not.toContain("arena_solapada");
  });

  it("la hora de fin explícita manda sobre la duración por defecto", async () => {
    const arena = await crearArena("Pista", 120);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        `update heats set arena_id = $1, scheduled_at = '2026-05-01 10:00-05',
           scheduled_end_at = '2026-05-01 10:10-05' where id = $2`,
        [arena, s.heatId],
      );
      await s.db.query(
        `insert into heats (event_id, name, lane_count, arena_id, scheduled_at)
         values ($1, 'Heat 2', 6, $2, '2026-05-01 10:20-05')`,
        [s.eventId, arena],
      );
    });

    // Con la duración por defecto de 120 min se pisarían; con el fin explícito
    // de 10 minutos, no.
    expect(codigos(await issues())).not.toContain("arena_solapada");
  });

  it("detecta al mismo juez asignado a dos heats simultáneos", async () => {
    const pista = await crearArena("Pista", 30);
    const piscina = await crearArena("Piscina", 30);
    await asignarJueces(s);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "update heats set arena_id = $1, scheduled_at = '2026-05-01 10:00-05' where id = $2",
        [pista, s.heatId],
      );
      const otro = await s.db.query<{ id: string }>(
        `insert into heats (event_id, name, lane_count, arena_id, scheduled_at)
         values ($1, 'Heat 2', 6, $2, '2026-05-01 10:10-05') returning id`,
        [s.eventId, piscina],
      );
      await s.db.query(
        `insert into lanes (heat_id, event_id, lane_number, judge_id) values ($1, $2, 1, $3)`,
        [otro.rows[0].id, s.eventId, s.users.judgeA],
      );
    });

    const filas = await issues();
    expect(codigos(filas)).toContain("juez_solapado");
    // El mensaje nombra a la persona: un id no le sirve a nadie.
    expect(filas.find((f) => f.code === "juez_solapado")?.detail).toMatch(/juez\.a@box\.com|Un juez/);
  });

  it("detecta al mismo atleta en dos pruebas simultáneas", async () => {
    const pista = await crearArena("Pista", 30);
    const piscina = await crearArena("Piscina", 30);

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "update heats set arena_id = $1, scheduled_at = '2026-05-01 10:00-05' where id = $2",
        [pista, s.heatId],
      );

      // Una prueba distinta, para que el equipo pueda tener dos carriles.
      const w = await s.db.query<{ id: string }>(
        "insert into workouts (event_id, order_index, name) values ($1, 9, 'Evento 2') returning id",
        [s.eventId],
      );
      await s.db.query(
        `insert into workout_parts (workout_id, event_id, order_index, time_scheme, score_unit, score_dir, window_ms)
         values ($1, $2, 0, 'ventana', 'reps', 'mayor_gana', 600000)`,
        [w.rows[0].id, s.eventId],
      );
      const otro = await s.db.query<{ id: string }>(
        `insert into heats (event_id, name, lane_count, arena_id, scheduled_at, workout_id)
         values ($1, 'Heat 2', 6, $2, '2026-05-01 10:10-05', $3) returning id`,
        [s.eventId, piscina, w.rows[0].id],
      );
      await s.db.query(
        "insert into lanes (heat_id, event_id, lane_number, team_id) values ($1, $2, 1, $3)",
        [otro.rows[0].id, s.eventId, s.teamIds[0]],
      );
    });

    const filas = await issues();
    expect(codigos(filas)).toContain("atleta_solapado");
    expect(filas.find((f) => f.code === "atleta_solapado")?.detail).toMatch(/dorsal 101/);
  });

  it("avisa de heats sin arena solo cuando hay más de una", async () => {
    await crearArena("Pista");
    expect(codigos(await issues())).not.toContain("heat_sin_arena");

    await crearArena("Piscina");
    expect(codigos(await issues())).toContain("heat_sin_arena");
  });
});

describe("colaboradores", () => {
  let colaborador: string;

  beforeEach(async () => {
    colaborador = await createUser(s.db, "staff@correo.com", "Sara Staff");
  });

  async function invitar(email: string, rol: string): Promise<string> {
    let id = "";
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ id: string }>(
        "select id from invite_event_staff($1, $2, $3)",
        [s.eventId, email, rol],
      );
      id = res.rows[0].id;
    });
    return id;
  }

  it("un correo con cuenta queda enlazado de una", async () => {
    await invitar("staff@correo.com", "scorekeeper");
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ user_id: string | null }>(
        "select user_id from event_staff where event_id = $1",
        [s.eventId],
      );
      expect(res.rows[0].user_id).toBe(colaborador);
    });
  });

  it("un correo sin cuenta queda pendiente y se enlaza al registrarse", async () => {
    await invitar("nuevo@correo.com", "judge");
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ user_id: string | null }>(
        "select user_id from event_staff where lower(invited_email) = 'nuevo@correo.com'",
      );
      expect(res.rows[0].user_id).toBeNull();
    });

    const nuevo = await createUser(s.db, "nuevo@correo.com");
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ user_id: string | null }>(
        "select user_id from event_staff where lower(invited_email) = 'nuevo@correo.com'",
      );
      expect(res.rows[0].user_id).toBe(nuevo);
    });
  });

  it("el acceso es a UN evento, no a la organización entera", async () => {
    await invitar("staff@correo.com", "manager");

    await asUser(s.db, s.users.owner, async () => {
      await s.db.query(
        "insert into events (org_id, name, public_slug, status) values ($1, 'Otra Copa', 'otra-copa', 'draft')",
        [s.orgId],
      );
    });

    await asUser(s.db, colaborador, async () => {
      const res = await s.db.query<{ name: string }>("select name from events");
      // Ve el evento donde colabora y ninguno más de la organización.
      expect(res.rows.map((r) => r.name)).toEqual(["Copa Test"]);
    });
  });

  it("un manager puede administrar el evento", async () => {
    await invitar("staff@correo.com", "manager");
    await asUser(s.db, colaborador, async () => {
      const res = await s.db.query<{ can_manage_event: boolean }>(
        "select can_manage_event($1)",
        [s.eventId],
      );
      expect(res.rows[0].can_manage_event).toBe(true);
    });
  });

  it("un verifier verifica pero no es manager", async () => {
    await invitar("staff@correo.com", "verifier");
    await asUser(s.db, colaborador, async () => {
      const res = await s.db.query<{ verificar: boolean; administrar: boolean }>(
        "select can_verify_event($1) as verificar, can_manage_event($1) as administrar",
        [s.eventId],
      );
      expect(res.rows[0].verificar).toBe(true);
      expect(res.rows[0].administrar).toBe(false);
    });
  });

  it("un scorekeeper carga resultados pero NO verifica ni publica", async () => {
    await invitar("staff@correo.com", "scorekeeper");
    await asUser(s.db, colaborador, async () => {
      const res = await s.db.query<{ cargar: boolean; verificar: boolean }>(
        "select can_score_event($1) as cargar, can_verify_event($1) as verificar",
        [s.eventId],
      );
      expect(res.rows[0].cargar).toBe(true);
      expect(res.rows[0].verificar).toBe(false);
    });
  });

  it("un registrar atiende inscripciones pero no administra el evento", async () => {
    await invitar("staff@correo.com", "registrar");
    await asUser(s.db, colaborador, async () => {
      const res = await s.db.query<{ inscribir: boolean; administrar: boolean }>(
        "select can_register_event($1) as inscribir, can_manage_event($1) as administrar",
        [s.eventId],
      );
      expect(res.rows[0].inscribir).toBe(true);
      expect(res.rows[0].administrar).toBe(false);
    });
  });

  // Un juez de EVENTO (a diferencia de un miembro de organizacion con rol de
  // juez) puede ser un desconocido contratado para una sola fecha: no tiene
  // por que ver nada de la competencia mas alla de su propio carril.
  // event_role() ya no lo traduce a ningun org_role -- por eso no administra
  // NI VE el evento (requireEventAccess() usa exactamente este RPC) -- pero
  // event_staff_role() lo sigue reconociendo como juez, que es lo unico que
  // necesitan claim_lane() y las funciones de /juez.
  it("un juez de evento no ve la competencia ni puede administrarla", async () => {
    await invitar("staff@correo.com", "judge");
    await asUser(s.db, colaborador, async () => {
      const res = await s.db.query<{
        rol: string | null;
        rol_staff: string;
        administrar: boolean;
      }>(
        "select event_role($1) as rol, event_staff_role($1) as rol_staff, can_manage_event($1) as administrar",
        [s.eventId],
      );
      expect(res.rows[0].rol).toBeNull();
      expect(res.rows[0].rol_staff).toBe("judge");
      expect(res.rows[0].administrar).toBe(false);
    });
  });

  it("volver a invitar al mismo correo cambia el rol en vez de duplicar", async () => {
    await invitar("staff@correo.com", "judge");
    await invitar("staff@correo.com", "verifier");

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ role: string }>(
        "select role from event_staff where event_id = $1",
        [s.eventId],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].role).toBe("verifier");
    });
  });

  it("un colaborador no puede invitar a otro", async () => {
    await invitar("staff@correo.com", "scorekeeper");
    await asUser(s.db, colaborador, () =>
      expectDenied(() =>
        s.db.query("select invite_event_staff($1, 'otro@correo.com', 'judge')", [s.eventId]),
      ),
    );
  });

  it("la organización lo puede quitar", async () => {
    const id = await invitar("staff@correo.com", "manager");
    await asUser(s.db, s.users.owner, () =>
      s.db.query("select remove_event_staff($1)", [id]),
    );

    await asUser(s.db, colaborador, async () => {
      const res = await s.db.query("select id from events");
      expect(res.rows).toEqual([]);
    });
  });

  it("nadie escribe la tabla de colaboradores directamente", async () => {
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query(
          "insert into event_staff (event_id, invited_email, role) values ($1, 'x@y.com', 'manager')",
          [s.eventId],
        ),
      ),
    );
  });

  it("el anónimo no llega a arenas ni a colaboradores", async () => {
    await asAnon(s.db, async () => {
      await expectDenied(() => s.db.query("select * from arenas"));
      await expectDenied(() => s.db.query("select * from event_staff"));
    });
  });
});

describe("los permisos de organización siguen intactos", () => {
  it("el dueño sigue administrando y verificando", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ a: boolean; v: boolean; c: boolean; i: boolean }>(
        `select can_manage_event($1) as a, can_verify_event($1) as v,
                can_score_event($1) as c, can_register_event($1) as i`,
        [s.eventId],
      );
      expect(res.rows[0]).toEqual({ a: true, v: true, c: true, i: true });
    });
  });

  it("un juez de la organización sigue sin poder administrar", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ a: boolean; v: boolean }>(
        "select can_manage_event($1) as a, can_verify_event($1) as v",
        [s.eventId],
      );
      expect(res.rows[0]).toEqual({ a: false, v: false });
    });
  });

  it("un forastero sigue sin ver nada", async () => {
    await asUser(s.db, s.users.forastero, async () => {
      const res = await s.db.query<{ rol: string | null }>("select event_role($1) as rol", [
        s.eventId,
      ]);
      expect(res.rows[0].rol).toBeNull();
    });
  });
});
