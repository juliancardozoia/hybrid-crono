/**
 * Escenario completo de una competencia, para no repetirlo en cada test.
 *
 * Arma lo mismo que armaria un organizador real: evento, circuito, division,
 * atletas, equipos con dorsal, un heat y sus carriles. Todo se crea pasando por
 * RLS con el usuario que corresponde, asi que si una politica esta mal el
 * fixture revienta y nos enteramos aca.
 */

import { asUser, createTestDb, createUser, type TestDb } from "./harness";

export interface Scenario {
  db: TestDb;
  orgId: string;
  eventId: string;
  divisionId: string;
  heatId: string;
  laneIds: string[];
  teamIds: string[];
  segmentIds: string[];
  users: {
    owner: string;
    headJudge: string;
    judgeA: string;
    judgeB: string;
    forastero: string; // miembro de otra organizacion
  };
}

const SEGMENTOS: Array<[string, "run" | "station"]> = [
  ["500m Run", "run"],
  ["SkiErg 500m", "station"],
  ["500m Run", "run"],
  ["Wall Balls 50", "station"],
];

export async function seedScenario(): Promise<Scenario> {
  const db = await createTestDb();

  const owner = await createUser(db, "owner@box.com");
  const headJudge = await createUser(db, "head@box.com");
  const judgeA = await createUser(db, "juez.a@box.com");
  const judgeB = await createUser(db, "juez.b@box.com");
  const forastero = await createUser(db, "ajeno@otrobox.com");

  let orgId = "";
  let eventId = "";
  let divisionId = "";
  let heatId = "";
  const laneIds: string[] = [];
  const teamIds: string[] = [];
  const segmentIds: string[] = [];

  await asUser(db, owner, async () => {
    orgId = (
      await db.query<{ id: string }>(
        "insert into organizations (name, slug, created_by) values ('Box Test', 'box-test', $1) returning id",
        [owner],
      )
    ).rows[0].id;

    for (const [user, role] of [
      [headJudge, "head_judge"],
      [judgeA, "judge"],
      [judgeB, "judge"],
    ] as const) {
      await db.query("insert into org_members (org_id, user_id, role) values ($1, $2, $3)", [
        orgId,
        user,
        role,
      ]);
    }

    eventId = (
      await db.query<{ id: string }>(
        "insert into events (org_id, name, public_slug, status) values ($1, 'Copa Test', 'copa-test', 'live') returning id",
        [orgId],
      )
    ).rows[0].id;

    const templateId = (
      await db.query<{ id: string }>(
        "insert into course_templates (event_id, name) values ($1, 'Circuito Test') returning id",
        [eventId],
      )
    ).rows[0].id;

    for (const [index, [name, kind]] of SEGMENTOS.entries()) {
      const seg = await db.query<{ id: string }>(
        `insert into segments (course_template_id, event_id, order_index, kind, name)
         values ($1, $2, $3, $4, $5) returning id`,
        [templateId, eventId, index, kind, name],
      );
      segmentIds.push(seg.rows[0].id);
    }

    divisionId = (
      await db.query<{ id: string }>(
        `insert into divisions (event_id, name, team_size, gender_rule, course_template_id)
         values ($1, 'Individual Masculino RX', 1, 'male', $2) returning id`,
        [eventId, templateId],
      )
    ).rows[0].id;

    await db.query(
      "insert into penalty_types (event_id, code, label, kind, seconds) values ($1, 'ROM', 'Rango de movimiento', 'time_add', 10)",
      [eventId],
    );

    heatId = (
      await db.query<{ id: string }>(
        "insert into heats (event_id, division_id, name, lane_count) values ($1, $2, 'Heat 1', 3) returning id",
        [eventId, divisionId],
      )
    ).rows[0].id;

    for (let i = 1; i <= 3; i += 1) {
      const athlete = await db.query<{ id: string }>(
        `insert into athletes (event_id, first_name, last_name, gender)
         values ($1, $2, 'Perez', 'male') returning id`,
        [eventId, `Atleta${i}`],
      );

      const team = await db.query<{ id: string }>(
        "insert into teams (event_id, division_id, bib_number) values ($1, $2, $3) returning id",
        [eventId, divisionId, 100 + i],
      );
      teamIds.push(team.rows[0].id);

      await db.query(
        "insert into team_members (team_id, athlete_id, event_id) values ($1, $2, $3)",
        [team.rows[0].id, athlete.rows[0].id, eventId],
      );

      const lane = await db.query<{ id: string }>(
        "insert into lanes (heat_id, event_id, lane_number, team_id) values ($1, $2, $3, $4) returning id",
        [heatId, eventId, i, team.rows[0].id],
      );
      laneIds.push(lane.rows[0].id);
    }
  });

  // El forastero tiene su propia organizacion, sin relacion con el evento.
  await asUser(db, forastero, async () => {
    await db.query(
      "insert into organizations (name, slug, created_by) values ('Otro Box', 'otro-box', $1)",
      [forastero],
    );
  });

  return {
    db,
    orgId,
    eventId,
    divisionId,
    heatId,
    laneIds,
    teamIds,
    segmentIds,
    users: { owner, headJudge, judgeA, judgeB, forastero },
  };
}

/**
 * Construye un marcaje EXACTAMENTE como lo manda el cliente.
 *
 * Atención con clientCapturedAt: va como numero (Date.now()), no como ISO string.
 * Cuando este fixture mandaba ISO, los tests pasaban y produccion fallaba en
 * cada marcaje. Si cambias el formato del cliente, cambialo aca tambien.
 */
export function marcaje(over: {
  id: string;
  laneId: string;
  seq: number;
  type: string;
  elapsedMs?: number;
  segmentId?: string | null;
  payload?: Record<string, unknown>;
  deviceId?: string;
  supersedesId?: string | null;
}) {
  return {
    elapsedMs: 0,
    segmentId: null,
    payload: {},
    deviceId: "dispositivo-test",
    clientCapturedAt: Date.now(),
    supersedesId: null,
    ...over,
  };
}

/**
 * Asigna un juez a todos los carriles con atleta.
 *
 * Hace falta antes de cualquier start_heat: la base no larga un heat con
 * carriles sin juez, que es la regla real de la competencia (ningun atleta
 * corre sin alguien que le tome los parciales).
 */
export async function asignarJueces(s: Scenario, judge = s.users.judgeA): Promise<void> {
  await asUser(s.db, judge, async () => {
    for (const laneId of s.laneIds) {
      await s.db.query("select claim_lane($1)", [laneId]);
    }
  });
}

/** Atajo para los tests que solo necesitan el heat corriendo. */
export async function largarHeat(s: Scenario, judge = s.users.judgeA): Promise<void> {
  await asignarJueces(s, judge);
  await asUser(s.db, s.users.owner, () => s.db.query("select start_heat($1)", [s.heatId]));
}
