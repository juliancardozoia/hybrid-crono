/**
 * Ejecuta contra el Supabase REAL todas las consultas con embeds que usa la app.
 *
 * POR QUE EXISTE
 *
 * Los tests de supabase/tests/ corren sobre PGlite, que es Postgres pero NO
 * tiene PostgREST. Los embeds de supabase-js (`teams (...)`, `events (...)`) los
 * resuelve PostgREST leyendo las claves foraneas, asi que un embed invalido
 * pasa los 137 tests y falla en produccion.
 *
 * Costo real: la pantalla del juez nunca funciono. `lanes` no tiene FK directa a
 * `events` — solo compuestas hacia heats y teams — y el embed `events (...)`
 * devolvia PGRST200. La consulta entera daba cero filas y la pantalla decia
 * "no hay carriles", sin ningun error visible.
 *
 *   node scripts/verify-queries.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/**
 * Cada entrada es la consulta tal como la escribe la app. Si cambias un embed
 * en el codigo, cambialo aca tambien: es la unica red que atrapa un embed
 * invalido antes de que lo vea un juez.
 */
const CONSULTAS = [
  {
    donde: "features/workouts/queries.ts · getGrillaDeCarga",
    tabla: "team_members",
    select: `
      team_id,
      athletes (first_name, last_name)
    `,
  },
  {
    donde: "features/judge/queries.ts · getJudgeLanes",
    tabla: "lanes",
    select: `
      id, lane_number, status, judge_id, event_id, team_id,
      heats (id, name, started_at, events (name, status)),
      teams (
        bib_number, name,
        divisions (name),
        team_members (athletes (first_name, last_name))
      )
    `,
  },
  {
    donde: "features/judge/lib/bundle.ts · fetchLaneBundle",
    tabla: "lanes",
    select: `
      id, event_id, lane_number, start_offset_ms, judge_id, workout_id,
      heats (id, name, started_at, events (name)),
      teams (
        bib_number, name,
        divisions (id, name, course_template_id),
        team_members (athletes (first_name, last_name))
      )
    `,
  },
  {
    donde: "features/events/config/queries.ts · getTeams",
    tabla: "teams",
    select:
      "*, divisions (name), team_members (athletes (id, first_name, last_name, gender, birth_date, email, country, document_id, state_province))",
  },
  {
    donde: "features/events/config/queries.ts · getHeats",
    tabla: "heats",
    select:
      "*, lanes (*, teams (bib_number, name, team_members (athletes (first_name, last_name))))",
  },
  {
    donde: "features/events/config/queries.ts · getJudges",
    tabla: "org_members",
    select: "user_id, role, profiles (full_name, email)",
  },
  {
    donde: "features/org/members.ts · getMiembros",
    tabla: "org_members",
    select: "user_id, role, profiles (full_name, email)",
  },
  {
    donde: "features/org/queries.ts · getMyOrganizations",
    tabla: "org_members",
    select: "role, organizations (id, name, slug)",
  },
  {
    donde: "features/verification/queries.ts · getLaneLog",
    tabla: "timing_events",
    select: "*, segments (name), profiles (full_name, email)",
  },
  {
    donde: "app/api/eventos/[id]/export · GET",
    tabla: "results",
    select:
      "*, teams (bib_number, name, team_members (athletes (first_name, last_name))), divisions (name)",
  },
];

let fallos = 0;

for (const c of CONSULTAS) {
  const { error } = await db.from(c.tabla).select(c.select).limit(1);

  if (error) {
    fallos += 1;
    console.log(`  FALLA  ${c.donde}`);
    console.log(`         ${error.code ?? ""} ${error.message}`);
    if (error.hint) console.log(`         pista: ${error.hint}`);
  } else {
    console.log(`   ok    ${c.donde}`);
  }
}

console.log(
  fallos === 0
    ? "\nTodas las consultas resuelven.\n"
    : `\n${fallos} consulta(s) rotas. Esas pantallas devuelven vacio sin mostrar ningun error.\n`,
);

process.exit(fallos === 0 ? 0 : 1);
