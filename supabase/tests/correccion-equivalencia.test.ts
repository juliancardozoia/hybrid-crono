/**
 * La garantia central de la correccion de resultados: el motor de puntuacion
 * es INDIFERENTE a como llego un valor a `workout_scores`.
 *
 * Este archivo cruza a proposito el limite que el resto de la suite respeta
 * (los tests de Postgres verifican que la base proyecta los datos correctos;
 * el calculo del ranking se prueba aparte, puro, en
 * `src/shared/scoring/*.test.ts` -- ver el comentario de
 * `etapas-y-cortes.test.ts`). Ese limite tiene sentido para no repetir la
 * matematica del motor en cada archivo, pero la pregunta que este test
 * contesta vive EXACTAMENTE en la costura entre los dos: si la organizacion
 * corrige un resultado que vino del juez, y otro equipo tiene ese MISMO valor
 * cargado a mano desde el principio, `rankPart` -la misma funcion pura que
 * arma el leaderboard real- tiene que darles el mismo puesto y los mismos
 * puntos. Si la correccion dejara algun rastro que el motor pudiera leer
 * (un campo, un orden, un redondeo distinto), esta prueba lo va a mostrar.
 *
 * Competencia A: un WOD juzgado en vivo, con un resultado corregido despues
 * de una impugnacion (115 reps -> 108).
 * Competencia B: la misma categoria, el mismo WOD, cargado a mano de punta a
 * punta -sin ningun juez, plan gratuito- con el valor YA CORRECTO (108) desde
 * el primer guardado.
 *
 * Se espera EXACTAMENTE lo mismo: mismo status, mismo valor normalizado,
 * misma posicion, mismos puntos, mismo empate.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asUser } from "./harness";
import { seedScenario, type Scenario } from "./fixtures";
import { rankPart } from "@/shared/scoring/place";
import { tablaDinamica } from "@/shared/scoring/points";
import type { PartSpec, RawScore } from "@/shared/scoring/types";

let s: Scenario;

beforeEach(async () => {
  s = await seedScenario();
  // Juzgar en vivo es del plan Pro; esta prueba no ejercita ese gate.
  await asAdmin(s.db, () =>
    s.db.query("update organizations set plan = 'pro' where id = $1", [s.orgId]),
  );
});

async function crearParte(nombre: string, captureMode: "en_vivo" | "manual"): Promise<string> {
  let partId = "";
  await asUser(s.db, s.users.owner, async () => {
    const orden = (
      await s.db.query<{ n: number }>(
        "select coalesce(max(order_index) + 1, 0)::int as n from workouts where event_id = $1",
        [s.eventId],
      )
    ).rows[0].n;
    const workout = await s.db.query<{ id: string }>(
      "insert into workouts (event_id, order_index, name) values ($1, $2, $3) returning id",
      [s.eventId, orden, nombre],
    );
    const parte = await s.db.query<{ id: string }>(
      `insert into workout_parts (
         workout_id, event_id, order_index, time_scheme, capture_mode, score_unit, score_dir, window_ms
       ) values ($1, $2, 0, 'ventana', $3, 'reps', 'mayor_gana', 600000) returning id`,
      [workout.rows[0].id, s.eventId, captureMode],
    );
    partId = parte.rows[0].id;
    await s.db.query(
      "insert into part_divisions (part_id, division_id, event_id) values ($1, $2, $3)",
      [partId, s.divisionId, s.eventId],
    );
  });
  return partId;
}

/** Trae los scores crudos de una parte, listos para `rankPart` -mismo mapeo
 *  que hace `buildScoreboard` con lo que devuelve `scoreboard_document`. */
async function crudosDeLaParte(partId: string): Promise<RawScore[]> {
  const res = await asUser(s.db, s.users.owner, () =>
    s.db.query<{
      team_id: string;
      status: RawScore["status"];
      value_num: string | null;
      value_reps: number | null;
      value_cap: string | null;
      tiebreak_value: string | null;
    }>(
      `select team_id, status, value_num, value_reps, value_cap, tiebreak_value
       from workout_scores where part_id = $1`,
      [partId],
    ),
  );
  // Se remapea partId a un id compartido: rankPart filtra por el, y las dos
  // partes reales tienen ids distintos aunque describan "la misma prueba".
  return res.rows.map((r) => ({
    partId: "comparacion",
    teamId: r.team_id,
    status: r.status,
    value: r.value_num === null ? null : Number(r.value_num),
    reps: r.value_reps,
    capValue: r.value_cap === null ? null : Number(r.value_cap),
    tiebreak: r.tiebreak_value === null ? null : Number(r.tiebreak_value),
    roundBreakdown: null,
  }));
}

describe("un score corregido rankea igual que el mismo valor cargado a mano", () => {
  it("115 corregido a 108 produce el mismo puesto y los mismos puntos que 108 cargado de punta a punta", async () => {
    const parteEnVivo = await crearParte("WOD con juez", "en_vivo");
    const parteManual = await crearParte("WOD sin juez", "manual");

    // --- Competencia A: el juez marco 115, la organizacion lo corrige a 108
    // tras revisar una impugnacion. Team 1 corre limpio con 80 (sin
    // impugnacion). Team 2 no se presento.
    await asAdmin(s.db, async () => {
      await s.db.query(
        `insert into workout_scores (part_id, team_id, event_id, division_id, score_unit, status, value_num, source, lane_id)
         values ($1, $2, $3, $4, 'reps', 'valido', 115, 'en_vivo', $5)`,
        [parteEnVivo, s.teamIds[0], s.eventId, s.divisionId, s.laneIds[0]],
      );
      await s.db.query(
        `insert into workout_scores (part_id, team_id, event_id, division_id, score_unit, status, value_num, source, lane_id)
         values ($1, $2, $3, $4, 'reps', 'valido', 80, 'en_vivo', $5)`,
        [parteEnVivo, s.teamIds[1], s.eventId, s.divisionId, s.laneIds[1]],
      );
      await s.db.query(
        `insert into workout_scores (part_id, team_id, event_id, division_id, score_unit, status, source, lane_id)
         values ($1, $2, $3, $4, 'reps', 'dnf', 'en_vivo', $5)`,
        [parteEnVivo, s.teamIds[2], s.eventId, s.divisionId, s.laneIds[2]],
      );
    });
    await asUser(s.db, s.users.headJudge, () =>
      s.db.query("select * from corregir_workout_score($1, $2, $3::jsonb, $4)", [
        parteEnVivo,
        s.teamIds[0],
        JSON.stringify({ value: 108 }),
        "Impugnacion revisada con el video del heat",
      ]),
    );

    // --- Competencia B: exactamente los mismos tres equipos, el mismo WOD,
    // cargado a mano de punta a punta -plan gratuito, sin app de juez-, con
    // el valor YA CORRECTO desde el primer guardado.
    await asUser(s.db, s.users.owner, async () => {
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteManual,
        s.teamIds[0],
        JSON.stringify({ value: 108 }),
      ]);
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteManual,
        s.teamIds[1],
        JSON.stringify({ value: 80 }),
      ]);
      await s.db.query("select * from upsert_workout_score($1, $2, $3::jsonb)", [
        parteManual,
        s.teamIds[2],
        JSON.stringify({ status: "dnf" }),
      ]);
    });

    const crudosA = await crudosDeLaParte(parteEnVivo);
    const crudosB = await crudosDeLaParte(parteManual);

    // Antes que nada: los VALORES persistidos tienen que coincidir. Si esto
    // fallara, el problema estaria en la carga, no en el motor.
    const porEquipo = (crudos: RawScore[]) =>
      new Map(crudos.map((c) => [c.teamId, { status: c.status, value: c.value }]));
    expect(porEquipo(crudosA)).toEqual(porEquipo(crudosB));

    const part: PartSpec = {
      id: "comparacion",
      orderIndex: 0,
      scoreUnit: "reps",
      scoreDir: "mayor_gana",
      capUnit: null,
      tiebreakUnit: null,
      tiebreakDir: null,
      tiebreakPartId: null,
    };
    const table = tablaDinamica(s.teamIds.length, 100, "same_position_points");
    const teamIds = s.teamIds;

    const rankeoA = rankPart({ part, table, teamIds, scores: crudosA });
    const rankeoB = rankPart({ part, table, teamIds, scores: crudosB });

    // LA AFIRMACION CENTRAL: la MISMA funcion pura, con el MISMO padron, da
    // exactamente el mismo resultado -posicion, empate y puntos incluidos-
    // sin importar que uno de los dos vino de una correccion sobre un valor
    // del juez y el otro nacio manual.
    expect(rankeoA).toEqual(rankeoB);

    // Y explicitamente lo que le importa a un organizador: quien gano, con
    // cuantos puntos, y que el que no se presento queda ultimo en los dos.
    const [primeroA] = rankeoA;
    expect(primeroA.teamId).toBe(s.teamIds[0]);
    expect(primeroA.points).toBeGreaterThan(0);
    expect(rankeoA.find((r) => r.teamId === s.teamIds[2])?.status).toBe("dnf");
  });
});
