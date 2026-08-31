/**
 * Verificacion de seguridad contra el proyecto REAL de Supabase.
 *
 * Los tests de supabase/tests/ corren sobre PGlite y ya cubren esto, pero el
 * entorno de test puede divergir del real: ya paso dos veces. Este script
 * comprueba contra la base de verdad, que es la unica que cuenta.
 *
 *   node scripts/verify-security.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let fallos = 0;
const ok = (m) => console.log("   ok    " + m);
const mal = (m) => {
  console.log("  FALLA  " + m);
  fallos++;
};

const TABLAS = [
  "organizations", "org_members", "events", "profiles", "course_templates", "segments",
  "divisions", "division_segment_specs", "penalty_types", "athletes", "teams",
  "team_members", "heats", "lanes", "lane_audit", "timing_events", "results",
  "result_publications",
];

console.log("\n== El esquema existe ==");
for (const t of TABLAS) {
  const { error } = await admin.from(t).select("*", { head: true, count: "exact" });
  error ? mal(`${t}: ${error.message}`) : ok(t);
}

console.log("\n== El anonimo no toca ninguna tabla ==");
for (const t of TABLAS) {
  const { error } = await anon.from(t).select("*", { head: true, count: "exact" });
  error ? ok(`${t} bloqueada`) : mal(`${t} es LEGIBLE por anon`);
}

console.log("\n== El anonimo no puede invocar las RPC internas ==");
for (const fn of [
  "claim_lane", "transfer_lane", "start_heat", "import_teams", "assign_heat_lanes",
  "ingest_timing_events", "void_timing_event", "reorder_segments", "user_org_role",
  "event_role", "can_manage_event", "shares_org_with", "event_config_issues",
  "verify_results", "publish_results", "verification_queue", "apply_function_lockdown",
]) {
  const { error } = await anon.rpc(fn, {});
  error ? ok(`${fn} bloqueada`) : mal(`${fn} es INVOCABLE por anon`);
}

console.log("\n== Pero las funciones publicas si funcionan ==");
for (const fn of ["public_leaderboard", "public_event_info"]) {
  const { error } = await anon.rpc(fn, { p_public_slug: "inexistente" });
  error ? mal(`${fn} rota: ${error.message}`) : ok(`${fn} accesible`);
}

console.log(fallos === 0 ? "\nTodo en orden.\n" : `\n${fallos} problema(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
