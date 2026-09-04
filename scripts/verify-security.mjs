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
  // Fases 9 a 14.
  "payment_providers", "discount_codes", "orders", "payment_attempts",
  "division_registration", "registration_fields", "registrations", "registration_members",
  "movements", "scoring_tables", "workouts", "workout_parts", "part_divisions",
  "part_blocks", "part_movements", "division_movement_specs", "workout_scores",
  "workout_score_audit", "standings", "event_documents",
  // Fases 15 y 16.
  "arenas", "event_staff", "billing_accounts", "division_movements", "event_staff_divisions",
  "organizations", "org_members", "events", "profiles", "course_templates", "segments",
  "divisions", "division_segment_specs", "penalty_types", "athletes", "teams",
  "team_members", "heats", "lanes", "lane_audit", "timing_events", "results",
  "result_publications",
];

// NUNCA uses `{ head: true }` para sondear una tabla.
//
// Con head, PostgREST responde 204 No Content y supabase-js devuelve
// `error: null` TAMBIEN cuando la tabla no existe o el rol no tiene permiso.
// Las dos comprobaciones de abajo pasaban SIEMPRE: el script daba por existente
// una tabla inventada y por bloqueada una que ni estaba creada. Se descubrio
// pidiendole `inexistente_xyz`, que reportaba "ok".
//
// Con `.limit(1)` viaja como mucho una fila y el error llega de verdad.
const sonda = (cliente, tabla) => cliente.from(tabla).select("*").limit(1);

console.log("\n== El esquema existe ==");
for (const t of TABLAS) {
  const { error } = await sonda(admin, t);
  error ? mal(`${t}: ${error.message}`) : ok(t);
}

// Ojo con leer esta seccion sola: una tabla que NO EXISTE tambien da error y
// se reporta como "bloqueada". Por eso la comprobacion del esquema va primero
// y ruidosa — si aquella falla, esta no significa nada.
console.log("\n== El anonimo no toca ninguna tabla ==");
for (const t of TABLAS) {
  const { error } = await sonda(anon, t);
  error ? ok(`${t} bloqueada`) : mal(`${t} es LEGIBLE por anon`);
}

console.log("\n== El anonimo no puede invocar las RPC internas ==");
for (const fn of [
  "claim_lane", "transfer_lane", "start_heat", "import_teams", "assign_heat_lanes",
  "ingest_timing_events", "void_timing_event", "reorder_segments", "user_org_role",
  "event_role", "can_manage_event", "shares_org_with", "event_config_issues",
  "verify_results", "publish_results", "verification_queue", "apply_function_lockdown",
  // Fases 9 a 12.
  "upsert_workout_score", "verify_workout_scores", "scoreboard_document",
  "ensure_circuit_part", "publish_event", "unpublish_event",
  "start_registration", "invite_member", "claim_membership", "save_member_data",
  "confirm_registration", "submit_registration", "cancel_registration",
  "upsert_order", "registrar_intento_de_pago", "confirmar_pago_manual", "medios_de_pago",
  "evaluar_descuento",
  // Fase 15.
  "invite_event_staff", "remove_event_staff", "event_staff_role", "can_score_event",
  "can_register_event", "event_schedule_issues", "ensure_my_organization",
  "can_delete_registrations", "can_manage_workouts", "puede_en_division",
  "org_staff_directory",
  // Fase 16.
  "activar_plan_pro", "cancelar_plan_pro", "guardar_medio_de_cobro", "event_plan_status",
  // Alta manual unificada con inscripciones.
  "admin_create_registration",
  // Jueces verificados: postulacion publica y aprobacion.
  "apply_as_judge", "approve_event_staff",
  // Jueces con alcance acotado: reemplazan el acceso directo a athletes/teams.
  "puede_leer_evento", "judge_visible_lanes", "judge_lane_bundle",
  "auto_distribuir_heats",
]) {
  const { error } = await anon.rpc(fn, {});
  error ? ok(`${fn} bloqueada`) : mal(`${fn} es INVOCABLE por anon`);
}

console.log("\n== Pero las funciones publicas si funcionan ==");
for (const fn of [
  "public_leaderboard", "public_event_info", "public_scoreboard", "public_event_detail",
  "public_registration_form", "public_participants", "public_judge_application_status",
]) {
  const { error } = await anon.rpc(fn, { p_public_slug: "inexistente" });
  error ? mal(`${fn} rota: ${error.message}`) : ok(`${fn} accesible`);
}

// Estas dos no reciben slug: el catalogo se abre sin buscar nada.
for (const [fn, args] of [["public_catalog_filters", {}], ["public_events_catalog", {}]]) {
  const { error } = await anon.rpc(fn, args);
  error ? mal(`${fn} rota: ${error.message}`) : ok(`${fn} accesible`);
}

console.log(fallos === 0 ? "\nTodo en orden.\n" : `\n${fallos} problema(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
