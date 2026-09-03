/**
 * El modelo de pruebas: estructura de los WOD, carga manual de scores y la
 * traduccion de lo que ya existia.
 *
 * Lo que mas importa de este archivo son dos cosas que no se ven a ojo:
 * que un evento Hyrox creado antes de la migracion siga funcionando igual, y
 * que las veinticinco estructuras de WOD que existen en la practica se puedan
 * expresar sin agregarle un campo al esquema.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, expectDenied } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
});

/** Crea una prueba con una parte y devuelve el id de la parte. */
async function crearParte(campos: {
  nombre: string;
  orden?: number;
  timeScheme: string;
  scoreUnit: string;
  scoreDir: string;
  captureMode?: string;
  timeCapMs?: number | null;
  capUnit?: string | null;
  windowMs?: number | null;
  intervalMs?: number | null;
  teamMode?: string;
}): Promise<string> {
  let partId = "";
  await asUser(s.db, s.users.owner, async () => {
    const orden =
      campos.orden ??
      (
        await s.db.query<{ n: number }>(
          "select coalesce(max(order_index) + 1, 0)::int as n from workouts where event_id = $1",
          [s.eventId],
        )
      ).rows[0].n;

    const workout = await s.db.query<{ id: string }>(
      "insert into workouts (event_id, order_index, name) values ($1, $2, $3) returning id",
      [s.eventId, orden, campos.nombre],
    );

    const parte = await s.db.query<{ id: string }>(
      `insert into workout_parts (
         workout_id, event_id, order_index, time_scheme, capture_mode,
         score_unit, score_dir, time_cap_ms, cap_unit, window_ms, interval_ms, team_mode
       ) values ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        workout.rows[0].id,
        s.eventId,
        campos.timeScheme,
        campos.captureMode ?? "manual",
        campos.scoreUnit,
        campos.scoreDir,
        campos.timeCapMs ?? null,
        campos.capUnit ?? null,
        campos.windowMs ?? null,
        campos.intervalMs ?? null,
        campos.teamMode ?? "individual",
      ],
    );

    partId = parte.rows[0].id;

    await s.db.query(
      "insert into part_divisions (part_id, division_id, event_id) values ($1, $2, $3)",
      [partId, s.divisionId, s.eventId],
    );
  });
  return partId;
}

async function agregarBloque(
  partId: string,
  bloque: { orden: number; kind?: string; repeticiones?: number; duracionMs?: number | null; descansoMs?: number | null },
): Promise<string> {
  let blockId = "";
  await asUser(s.db, s.users.owner, async () => {
    const res = await s.db.query<{ id: string }>(
      `insert into part_blocks (part_id, event_id, order_index, kind, repeticiones, duracion_ms, descanso_ms)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        partId,
        s.eventId,
        bloque.orden,
        bloque.kind ?? "trabajo",
        bloque.repeticiones ?? 1,
        bloque.duracionMs ?? null,
        bloque.descansoMs ?? null,
      ],
    );
    blockId = res.rows[0].id;
  });
  return blockId;
}

async function agregarMovimiento(
  blockId: string,
  partId: string,
  mov: {
    orden: number;
    slug?: string;
    customName?: string;
    unit?: string;
    targetPerRound?: number[];
    loadKg?: number | null;
    maxReps?: boolean;
    esTiebreak?: boolean;
  },
): Promise<string> {
  let id = "";
  await asUser(s.db, s.users.owner, async () => {
    const movementId = mov.slug
      ? (
          await s.db.query<{ id: string }>("select id from movements where slug = $1", [mov.slug])
        ).rows[0].id
      : null;

    const res = await s.db.query<{ id: string }>(
      `insert into part_movements (
         block_id, part_id, event_id, order_index, movement_id, custom_name,
         unit, target_per_round, load_kg, max_reps, es_tiebreak
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        blockId,
        partId,
        s.eventId,
        mov.orden,
        movementId,
        mov.customName ?? null,
        mov.unit ?? "reps",
        mov.targetPerRound ?? [1],
        mov.loadKg ?? null,
        mov.maxReps ?? false,
        mov.esTiebreak ?? false,
      ],
    );
    id = res.rows[0].id;
  });
  return id;
}

describe("la traduccion de lo que ya existia", () => {
  it("el evento sembrado quedo con una prueba de circuito", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ name: string; time_scheme: string; capture_mode: string }>(
        `select w.name, p.time_scheme, p.capture_mode
         from workouts w join workout_parts p on p.workout_id = w.id
         where w.event_id = $1`,
        [s.eventId],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].name).toBe("Circuito");
      expect(res.rows[0].time_scheme).toBe("circuito");
      // El circuito se sigue cronometrando en vivo, como siempre.
      expect(res.rows[0].capture_mode).toBe("en_vivo");
    });
  });

  it("la categoria conserva EXACTAMENTE el circuito que ya corria", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ igual: boolean }>(
        `select pd.course_template_id = d.course_template_id as igual
         from part_divisions pd
         join divisions d on d.id = pd.division_id
         where d.id = $1`,
        [s.divisionId],
      );
      expect(res.rows[0].igual).toBe(true);
    });
  });

  it("los heats y carriles que ya existian quedaron atados a la prueba", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const heats = await s.db.query<{ n: number }>(
        "select count(*)::int as n from heats where event_id = $1 and workout_id is null",
        [s.eventId],
      );
      const lanes = await s.db.query<{ n: number }>(
        "select count(*)::int as n from lanes where event_id = $1 and workout_id is null",
        [s.eventId],
      );
      expect(heats.rows[0].n).toBe(0);
      expect(lanes.rows[0].n).toBe(0);
    });
  });

  it("un heat nuevo toma la prueba del evento sin que nadie se la pase", async () => {
    // createHeat no sabe que existen las pruebas y no tiene por que aprenderlo.
    await asUser(s.db, s.users.owner, async () => {
      const heat = await s.db.query<{ workout_id: string }>(
        "insert into heats (event_id, name, lane_count) values ($1, 'Heat 2', 4) returning workout_id",
        [s.eventId],
      );
      expect(heat.rows[0].workout_id).not.toBeNull();
    });
  });

  it("una categoria nueva queda inscripta sola en la prueba de circuito", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const templateId = (
        await s.db.query<{ course_template_id: string }>(
          "select course_template_id from divisions where id = $1",
          [s.divisionId],
        )
      ).rows[0].course_template_id;

      const nueva = await s.db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Individual Femenino RX', 1, 'female', $2) returning id`,
        [s.eventId, templateId],
      );

      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from part_divisions where division_id = $1",
        [nueva.rows[0].id],
      );
      expect(res.rows[0].n).toBe(1);
    });
  });

  it("los resultados que ya estaban se copiaron como scores del circuito", async () => {
    // El fixture no genera results, asi que se verifica que la consulta del
    // backfill no rompa y que la tabla exista vacia para este evento.
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query("select * from workout_scores where event_id = $1", [s.eventId]);
      expect(res.rows).toEqual([]);
    });
  });
});

describe("un equipo corre una vez por prueba", () => {
  it("el mismo equipo puede correr dos pruebas distintas", async () => {
    const otra = await crearParte({
      nombre: "Evento 2",
      timeScheme: "ventana",
      scoreUnit: "rondas_reps",
      scoreDir: "mayor_gana",
      windowMs: 1_200_000,
    });
    expect(otra).toBeTruthy();

    await asUser(s.db, s.users.owner, async () => {
      const workoutId = (
        await s.db.query<{ workout_id: string }>(
          "select workout_id from workout_parts where id = $1",
          [otra],
        )
      ).rows[0].workout_id;

      const heat = await s.db.query<{ id: string }>(
        "insert into heats (event_id, name, lane_count, workout_id) values ($1, 'Heat E2', 3, $2) returning id",
        [s.eventId, workoutId],
      );

      // El equipo 0 ya tiene un carril en la prueba de circuito.
      await s.db.query(
        "insert into lanes (heat_id, event_id, lane_number, team_id) values ($1, $2, 1, $3)",
        [heat.rows[0].id, s.eventId, s.teamIds[0]],
      );

      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from lanes where team_id = $1",
        [s.teamIds[0]],
      );
      expect(res.rows[0].n).toBe(2);
    });
  });

  it("pero no puede tener dos carriles en la misma prueba", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const heat = await s.db.query<{ id: string }>(
        "insert into heats (event_id, name, lane_count) values ($1, 'Heat 1 bis', 3) returning id",
        [s.eventId],
      );

      const mensaje = await expectDenied(() =>
        s.db.query(
          "insert into lanes (heat_id, event_id, lane_number, team_id) values ($1, $2, 1, $3)",
          [heat.rows[0].id, s.eventId, s.teamIds[0]],
        ),
      );
      expect(mensaje).toMatch(/lanes_team_once_per_workout|duplicate key/i);
    });
  });
});

describe("carga manual de un score", () => {
  let parteReps = "";

  beforeEach(async () => {
    parteReps = await crearParte({
      nombre: "Evento 2",
      timeScheme: "ventana",
      scoreUnit: "reps",
      scoreDir: "mayor_gana",
      windowMs: 600_000,
    });
  });

  it("el organizador carga un resultado", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ value_num: string; status: string }>(
        "select value_num, status from upsert_workout_score($1, $2, $3::jsonb)",
        [parteReps, s.teamIds[0], JSON.stringify({ value: 152 })],
      );
      expect(Number(res.rows[0].value_num)).toBe(152);
      expect(res.rows[0].status).toBe("valido");
    });
  });

  it("el head judge tambien puede cargar", async () => {
    await asUser(s.db, s.users.headJudge, async () => {
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteReps,
        s.teamIds[0],
        JSON.stringify({ value: 100 }),
      ]);
    });
  });

  it("un juez comun no puede cargar resultados", async () => {
    const mensaje = await asUser(s.db, s.users.judgeA, () =>
      expectDenied(() =>
        s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
          parteReps,
          s.teamIds[0],
          JSON.stringify({ value: 100 }),
        ]),
      ),
    );
    expect(mensaje).toMatch(/permiso/i);
  });

  it("un forastero no puede cargar resultados", async () => {
    await asUser(s.db, s.users.forastero, () =>
      expectDenied(() =>
        s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
          parteReps,
          s.teamIds[0],
          JSON.stringify({ value: 100 }),
        ]),
      ),
    );
  });

  it("la unidad, el evento y la categoria los pone el servidor, no el payload", async () => {
    // Misma leccion que recorded_by = auth.uid() en ingest_timing_events: si
    // viene en el payload, se puede falsear.
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ score_unit: string; event_id: string; division_id: string }>(
        "select score_unit, event_id, division_id from upsert_workout_score($1, $2, $3::jsonb)",
        [
          parteReps,
          s.teamIds[0],
          JSON.stringify({ value: 10, scoreUnit: "carga", eventId: "x", divisionId: "y" }),
        ],
      );
      expect(res.rows[0].score_unit).toBe("reps");
      expect(res.rows[0].event_id).toBe(s.eventId);
      expect(res.rows[0].division_id).toBe(s.divisionId);
    });
  });

  it("verificar sella los scores sin tocar ningun valor", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteReps,
        s.teamIds[0],
        JSON.stringify({ value: 142 }),
      ]);

      const sellados = await s.db.query<{ verify_workout_scores: number }>(
        "select verify_workout_scores($1, $2)",
        [s.eventId, parteReps],
      );
      expect(sellados.rows[0].verify_workout_scores).toBe(1);

      const res = await s.db.query<{ verified_at: string | null; value_num: string }>(
        "select verified_at, value_num from workout_scores where part_id = $1 and team_id = $2",
        [parteReps, s.teamIds[0]],
      );
      expect(res.rows[0].verified_at).not.toBeNull();
      expect(Number(res.rows[0].value_num)).toBe(142);
    });
  });

  it("corregir un score verificado lo deja sin verificar", async () => {
    // Si alguien lo toco despues de la revision, hay que volver a mirarlo.
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteReps,
        s.teamIds[0],
        JSON.stringify({ value: 142 }),
      ]);
      await s.db.query("select verify_workout_scores($1, $2)", [s.eventId, parteReps]);

      const res = await s.db.query<{ verified_at: string | null }>(
        "select verified_at from upsert_workout_score($1, $2, $3::jsonb)",
        [parteReps, s.teamIds[0], JSON.stringify({ value: 152 })],
      );
      expect(res.rows[0].verified_at).toBeNull();
    });
  });

  it("un juez comun no puede verificar scores", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteReps,
        s.teamIds[0],
        JSON.stringify({ value: 142 }),
      ]);
    });
    await asUser(s.db, s.users.judgeA, () =>
      expectDenied(() => s.db.query("select verify_workout_scores($1)", [s.eventId])),
    );
  });

  it("una prueba que se juzga en vivo no se carga a mano", async () => {
    // Juzgar un WOD en vivo es del plan Pro; el gate se prueba en planes.test.ts.
    await asAdmin(s.db, () =>
      s.db.query("update organizations set plan = 'pro' where id = $1", [s.orgId]),
    );
    const enVivo = await crearParte({
      nombre: "Evento 3",
      timeScheme: "cap",
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
      captureMode: "en_vivo",
      timeCapMs: 1_200_000,
      capUnit: "reps",
    });

    const mensaje = await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
          enVivo,
          s.teamIds[0],
          JSON.stringify({ value: 100 }),
        ]),
      ),
    );
    expect(mensaje).toMatch(/en vivo/i);
  });

  it("no se puede cargar un score de una categoria que no corre esa prueba", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const templateId = (
        await s.db.query<{ course_template_id: string }>(
          "select course_template_id from divisions where id = $1",
          [s.divisionId],
        )
      ).rows[0].course_template_id;

      const otraDivision = await s.db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Masters', 1, 'any', $2) returning id`,
        [s.eventId, templateId],
      );
      const equipo = await s.db.query<{ id: string }>(
        "insert into teams (event_id, division_id, bib_number) values ($1, $2, 900) returning id",
        [s.eventId, otraDivision.rows[0].id],
      );

      const mensaje = await expectDenied(() =>
        s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
          parteReps,
          equipo.rows[0].id,
          JSON.stringify({ value: 10 }),
        ]),
      );
      expect(mensaje).toMatch(/no corre esta prueba/i);
    });
  });

  it("cada cambio queda auditado con quien lo hizo", async () => {
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteReps,
        s.teamIds[0],
        JSON.stringify({ value: 142 }),
      ]);
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteReps,
        s.teamIds[0],
        JSON.stringify({ value: 152 }),
      ]);

      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from workout_score_audit where part_id = $1 and team_id = $2",
        [parteReps, s.teamIds[0]],
      );
      expect(res.rows[0].n).toBe(2);

      const ultimo = await s.db.query<{ antes: { value_num: string }; actor_id: string }>(
        `select antes, actor_id from workout_score_audit
         where part_id = $1 and team_id = $2 order by created_at desc limit 1`,
        [parteReps, s.teamIds[0]],
      );
      expect(Number(ultimo.rows[0].antes.value_num)).toBe(142);
      expect(ultimo.rows[0].actor_id).toBe(s.users.owner);
    });
  });

  it("un score derivado no puede entrar en una prueba de carga manual", async () => {
    // Es la mitad que falta del par: upsert_workout_score() ya rechaza las
    // pruebas en vivo. Sin esta, un recalculo podria reducir una prueba manual
    // a "pendiente" y borrar el score que el staff cargo a mano.
    await asAdmin(s.db, async () => {
      const mensaje = await expectDenied(() =>
        s.db.query(
          `insert into workout_scores (part_id, team_id, event_id, division_id, score_unit, status, value_num, source, lane_id)
           values ($1, $2, $3, $4, 'reps', 'valido', 10, 'en_vivo', $5)`,
          [parteReps, s.teamIds[0], s.eventId, s.divisionId, s.laneIds[0]],
        ),
      );
      expect(mensaje).toMatch(/se captura en modo/i);
    });
  });

  it("nadie escribe la tabla de scores directamente", async () => {
    // La garantia es un privilegio ausente, no una politica presente: sin GRANT
    // de insert, todo pasa por la funcion o por el service role.
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query(
          `insert into workout_scores (part_id, team_id, event_id, division_id, score_unit, status, value_num)
           values ($1, $2, $3, $4, 'reps', 'valido', 999)`,
          [parteReps, s.teamIds[0], s.eventId, s.divisionId],
        ),
      ),
    );
  });
});

describe("la superficie del anonimo", () => {
  it("no llega a ninguna de las tablas nuevas", async () => {
    const tablas = [
      "movements",
      "scoring_tables",
      "workouts",
      "workout_parts",
      "part_divisions",
      "part_blocks",
      "part_movements",
      "division_movement_specs",
      "workout_scores",
      "workout_score_audit",
      "standings",
    ];

    await asAnon(s.db, async () => {
      for (const tabla of tablas) {
        await expectDenied(() => s.db.query(`select * from ${tabla} limit 1`));
      }
    });
  });

  it("no puede cargar un score ni crear una prueba", async () => {
    await asAnon(s.db, async () => {
      await expectDenied(() =>
        s.db.query("select * from upsert_workout_score($1, $2, '{}'::jsonb)", [
          s.divisionId,
          s.teamIds[0],
        ]),
      );
      await expectDenied(() => s.db.query("select ensure_circuit_part($1)", [s.eventId]));
    });
  });
});

describe("validaciones de configuracion", () => {
  it("sigue reportando una categoria cuyo circuito no tiene segmentos", async () => {
    // Esta es la regresion que importa: al volver nullable
    // divisions.course_template_id, la version vieja comparaba contra NULL,
    // nunca daba true, y DEJABA DE PROTEGER sin tirar ningun error.
    await asUser(s.db, s.users.owner, async () => {
      const vacio = await s.db.query<{ id: string }>(
        "insert into course_templates (event_id, name) values ($1, 'Circuito vacio') returning id",
        [s.eventId],
      );
      await s.db.query(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Sin segmentos', 1, 'any', $2)`,
        [s.eventId, vacio.rows[0].id],
      );

      const res = await s.db.query<{ code: string }>(
        "select code from event_config_issues($1) where code = 'division_sin_segmentos'",
        [s.eventId],
      );
      expect(res.rows).toHaveLength(1);
    });
  });

  it("reporta una categoria que no corre ninguna prueba", async () => {
    await asUser(s.db, s.users.owner, async () => {
      // Una categoria sin circuito no dispara el trigger que la inscribe.
      await s.db.query(
        `insert into divisions (event_id, name, team_size, gender_rule)
         values ($1, 'Huerfana', 1, 'any')`,
        [s.eventId],
      );

      const res = await s.db.query<{ detail: string }>(
        "select detail from event_config_issues($1) where code = 'division_sin_pruebas'",
        [s.eventId],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].detail).toContain("Huerfana");
    });
  });

  it("reporta una prueba de CrossFit sin movimientos cargados", async () => {
    await crearParte({
      nombre: "Evento 2",
      timeScheme: "ventana",
      scoreUnit: "reps",
      scoreDir: "mayor_gana",
      windowMs: 600_000,
    });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ code: string }>(
        "select code from event_config_issues($1) where code = 'prueba_sin_movimientos'",
        [s.eventId],
      );
      expect(res.rows).toHaveLength(1);
    });
  });

  it("un circuito no necesita movimientos: su estructura son los segmentos", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query(
        "select code from event_config_issues($1) where code = 'prueba_sin_movimientos'",
        [s.eventId],
      );
      expect(res.rows).toEqual([]);
    });
  });
});

/**
 * El criterio de aceptacion del modelo: si una estructura real no entra sin
 * agregarle un campo al esquema, el modelo esta mal.
 */
describe("las estructuras de WOD que existen en la practica", () => {
  it("Fran: 21-15-9 por tiempo con cap", async () => {
    const parte = await crearParte({
      nombre: "Fran",
      timeScheme: "cap",
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
      timeCapMs: 600_000,
      capUnit: "reps",
    });
    const bloque = await agregarBloque(parte, { orden: 0, repeticiones: 3 });
    await agregarMovimiento(bloque, parte, {
      orden: 0,
      slug: "thruster",
      targetPerRound: [21, 15, 9],
      loadKg: 43,
    });
    await agregarMovimiento(bloque, parte, {
      orden: 1,
      slug: "pull-up",
      targetPerRound: [21, 15, 9],
    });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ target_per_round: number[] }>(
        "select target_per_round from part_movements where part_id = $1 order by order_index",
        [parte],
      );
      // El esquema de reps es un arreglo: la escalera no necesita tabla aparte.
      expect(res.rows[0].target_per_round).toEqual([21, 15, 9]);
    });
  });

  it("Cindy: AMRAP en ventana fija, score de rondas y reps", async () => {
    const parte = await crearParte({
      nombre: "Cindy",
      timeScheme: "ventana",
      scoreUnit: "rondas_reps",
      scoreDir: "mayor_gana",
      windowMs: 1_200_000,
    });
    const bloque = await agregarBloque(parte, { orden: 0, repeticiones: 200 });
    await agregarMovimiento(bloque, parte, { orden: 0, slug: "pull-up", targetPerRound: [5] });
    await agregarMovimiento(bloque, parte, { orden: 1, slug: "push-up", targetPerRound: [10] });
    await agregarMovimiento(bloque, parte, { orden: 2, slug: "air-squat", targetPerRound: [15] });
    expect(parte).toBeTruthy();
  });

  it("chipper: un solo paso por una lista larga", async () => {
    const parte = await crearParte({
      nombre: "Filthy Fifty",
      timeScheme: "cap",
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
      timeCapMs: 1_800_000,
      capUnit: "reps",
    });
    const bloque = await agregarBloque(parte, { orden: 0, repeticiones: 1 });
    const movimientos = ["box-jump", "pull-up", "kettlebell-swing", "walking-lunge", "knees-to-elbows"];
    for (const [i, slug] of movimientos.entries()) {
      await agregarMovimiento(bloque, parte, { orden: i, slug, targetPerRound: [50] });
    }

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from part_movements where block_id = $1",
        [bloque],
      );
      expect(res.rows[0].n).toBe(5);
    });
  });

  it("buy-in y cash-out son bloques con su tipo", async () => {
    const parte = await crearParte({
      nombre: "Con bookends",
      timeScheme: "libre",
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
    });
    const entrada = await agregarBloque(parte, { orden: 0, kind: "buy_in", repeticiones: 1 });
    await agregarMovimiento(entrada, parte, { orden: 0, slug: "double-under", targetPerRound: [50] });
    const trabajo = await agregarBloque(parte, { orden: 1, kind: "trabajo", repeticiones: 3 });
    await agregarMovimiento(trabajo, parte, { orden: 0, slug: "burpee", targetPerRound: [15] });
    const salida = await agregarBloque(parte, { orden: 2, kind: "cash_out", repeticiones: 1 });
    await agregarMovimiento(salida, parte, { orden: 0, slug: "double-under", targetPerRound: [50] });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ kind: string }>(
        "select kind from part_blocks where part_id = $1 order by order_index",
        [parte],
      );
      expect(res.rows.map((r) => r.kind)).toEqual(["buy_in", "trabajo", "cash_out"]);
    });
  });

  it("Tabata: intervalos de 20s con 10s de descanso, ocho veces", async () => {
    const parte = await crearParte({
      nombre: "Tabata",
      timeScheme: "intervalos",
      scoreUnit: "reps",
      scoreDir: "mayor_gana",
      intervalMs: 30_000,
    });
    const bloque = await agregarBloque(parte, {
      orden: 0,
      repeticiones: 8,
      duracionMs: 20_000,
      descansoMs: 10_000,
    });
    await agregarMovimiento(bloque, parte, { orden: 0, slug: "air-squat", maxReps: true });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ repeticiones: number; duracion_ms: number; descanso_ms: number }>(
        "select repeticiones, duracion_ms, descanso_ms from part_blocks where id = $1",
        [bloque],
      );
      expect(res.rows[0]).toMatchObject({ repeticiones: 8, duracion_ms: 20_000, descanso_ms: 10_000 });
    });
  });

  it("Death By: intervalos con objetivo ascendente", async () => {
    const parte = await crearParte({
      nombre: "Death By Burpees",
      timeScheme: "intervalos",
      scoreUnit: "rondas",
      scoreDir: "mayor_gana",
      intervalMs: 60_000,
    });
    const bloque = await agregarBloque(parte, { orden: 0, repeticiones: 30, duracionMs: 60_000 });
    // El objetivo sube de a uno por minuto. Sale del mismo arreglo que la
    // escalera de Fran, sin ningun campo nuevo.
    const ascendente = Array.from({ length: 30 }, (_, i) => i + 1);
    await agregarMovimiento(bloque, parte, {
      orden: 0,
      slug: "burpee",
      targetPerRound: ascendente,
    });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ target_per_round: number[] }>(
        "select target_per_round from part_movements where part_id = $1",
        [parte],
      );
      expect(res.rows[0].target_per_round).toHaveLength(30);
      expect(res.rows[0].target_per_round[29]).toBe(30);
    });
  });

  it("Fight Gone Bad: estaciones de un minuto con reps al maximo", async () => {
    const parte = await crearParte({
      nombre: "Fight Gone Bad",
      timeScheme: "intervalos",
      scoreUnit: "reps",
      scoreDir: "mayor_gana",
      intervalMs: 60_000,
    });
    const bloque = await agregarBloque(parte, { orden: 0, repeticiones: 3, duracionMs: 60_000 });
    for (const [i, slug] of ["wall-ball-shot", "sumo-deadlift-high-pull", "box-jump", "push-press", "row"].entries()) {
      await agregarMovimiento(bloque, parte, {
        orden: i,
        slug,
        unit: slug === "row" ? "calorias" : "reps",
        maxReps: true,
      });
    }

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from part_movements where part_id = $1 and max_reps",
        [parte],
      );
      expect(res.rows[0].n).toBe(5);
    });
  });

  it("carga maxima: sin reloj, score en kilos", async () => {
    const parte = await crearParte({
      nombre: "1RM Clean and Jerk",
      timeScheme: "sin_reloj",
      scoreUnit: "carga",
      scoreDir: "mayor_gana",
    });
    const bloque = await agregarBloque(parte, { orden: 0, repeticiones: 1 });
    await agregarMovimiento(bloque, parte, { orden: 0, slug: "clean-and-jerk", unit: "kg" });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ value_num: string }>(
        "select value_num from upsert_workout_score($1, $2, $3::jsonb)",
        [parte, s.teamIds[0], JSON.stringify({ value: 102.5 })],
      );
      // Los kilos con decimales sobreviven el viaje: comparar floats mal
      // detectados corre todas las posiciones de abajo.
      expect(Number(res.rows[0].value_num)).toBe(102.5);
    });
  });

  it("una prueba de dos partes: AMRAP y despues carga maxima", async () => {
    await asUser(s.db, s.users.owner, async () => {
      const workout = await s.db.query<{ id: string }>(
        "insert into workouts (event_id, order_index, name) values ($1, 5, 'Evento 5') returning id",
        [s.eventId],
      );

      for (const [i, parte] of [
        { label: "A", scheme: "ventana", unit: "rondas_reps", dir: "mayor_gana", window: 480_000, interval: null },
        { label: "B", scheme: "sin_reloj", unit: "carga", dir: "mayor_gana", window: null, interval: null },
      ].entries()) {
        await s.db.query(
          `insert into workout_parts (workout_id, event_id, order_index, label, time_scheme, score_unit, score_dir, window_ms, interval_ms)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [workout.rows[0].id, s.eventId, i, parte.label, parte.scheme, parte.unit, parte.dir, parte.window, parte.interval],
        );
      }

      const res = await s.db.query<{ label: string }>(
        "select label from workout_parts where workout_id = $1 order by order_index",
        [workout.rows[0].id],
      );
      expect(res.rows.map((r) => r.label)).toEqual(["A", "B"]);
    });
  });

  it("formatos de equipo: sincronizado, alternado y relevo", async () => {
    for (const modo of ["sincronizado", "alternado", "relevo", "reparto_libre"]) {
      const parte = await crearParte({
        nombre: `Equipo ${modo}`,
        timeScheme: "libre",
        scoreUnit: "tiempo",
        scoreDir: "menor_gana",
        teamMode: modo,
      });
      expect(parte).toBeTruthy();
    }
  });

  it("un movimiento que no esta en el catalogo se escribe a mano", async () => {
    const parte = await crearParte({
      nombre: "Con movimiento raro",
      timeScheme: "libre",
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
    });
    const bloque = await agregarBloque(parte, { orden: 0 });
    await agregarMovimiento(bloque, parte, {
      orden: 0,
      customName: "Subida de cuerda con chaleco",
      targetPerRound: [3],
    });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ custom_name: string; movement_id: string | null }>(
        "select custom_name, movement_id from part_movements where part_id = $1",
        [parte],
      );
      expect(res.rows[0].custom_name).toBe("Subida de cuerda con chaleco");
      expect(res.rows[0].movement_id).toBeNull();
    });
  });

  it("un movimiento no puede ser del catalogo y escrito a mano a la vez", async () => {
    const parte = await crearParte({
      nombre: "Ambiguo",
      timeScheme: "libre",
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
    });
    const bloque = await agregarBloque(parte, { orden: 0 });

    await asUser(s.db, s.users.owner, async () => {
      const movementId = (
        await s.db.query<{ id: string }>("select id from movements where slug = 'burpee'")
      ).rows[0].id;

      await expectDenied(() =>
        s.db.query(
          `insert into part_movements (block_id, part_id, event_id, order_index, movement_id, custom_name, unit)
           values ($1, $2, $3, 0, $4, 'Otro', 'reps')`,
          [bloque, parte, s.eventId, movementId],
        ),
      );
    });
  });

  it("el desempate se marca en un movimiento, no con un tap extra del juez", async () => {
    const parte = await crearParte({
      nombre: "Con hito",
      timeScheme: "cap",
      scoreUnit: "tiempo",
      scoreDir: "menor_gana",
      timeCapMs: 1_200_000,
      capUnit: "reps",
    });
    const bloque = await agregarBloque(parte, { orden: 0, repeticiones: 5 });
    await agregarMovimiento(bloque, parte, {
      orden: 0,
      slug: "wall-walk",
      targetPerRound: [5],
      esTiebreak: true,
    });

    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ n: number }>(
        "select count(*)::int as n from part_movements where part_id = $1 and es_tiebreak",
        [parte],
      );
      expect(res.rows[0].n).toBe(1);
    });
  });
});

describe("el catalogo de movimientos", () => {
  it("viene sembrado y lo lee cualquier usuario logueado", async () => {
    await asUser(s.db, s.users.judgeA, async () => {
      const res = await s.db.query<{ n: number }>("select count(*)::int as n from movements");
      expect(res.rows[0].n).toBeGreaterThan(100);
    });
  });

  it("el organizador no lo edita: el ABM es de la plataforma", async () => {
    await asUser(s.db, s.users.owner, () =>
      expectDenied(() =>
        s.db.query(
          "insert into movements (name, slug, category) values ('Invento', 'invento', 'otro')",
        ),
      ),
    );
  });

  it("las tablas de puntos estandar no copian sus valores a la base", async () => {
    // Si estuvieran en los dos lados, tarde o temprano difieren y el podio
    // dependeria de cual leyo cada pantalla.
    await asUser(s.db, s.users.owner, async () => {
      const res = await s.db.query<{ builtin_key: string; points: number[] }>(
        "select builtin_key, points from scoring_tables where org_id is null order by builtin_key",
      );
      expect(res.rows.map((r) => r.builtin_key)).toEqual([
        "cf_games_40",
        "cf_games_80",
        "cf_open",
        "tiempo_total",
      ]);
      expect(res.rows.every((r) => r.points.length === 0)).toBe(true);
    });
  });
});
