/**
 * Borra TODAS las competencias de TODAS las organizaciones, y todo lo que
 * cuelga de cada evento, sin tocar organizaciones, membresias ni cuentas de
 * usuario.
 *
 *   node scripts/borrar-competencias.mjs
 *
 * Que se preserva a proposito:
 *   - `organizations`: la organizacion sigue existiendo, solo queda sin
 *     competencias.
 *   - `org_members`: la membresia de organizacion (incluidos los jueces a
 *     nivel organizacion) no se toca.
 *   - `auth.users` / `profiles`: ninguna cuenta se borra.
 *   - `payment_providers`, `billing_accounts`: son de la organizacion, no del
 *     evento.
 *   - `movements`: el catalogo global de movimientos.
 *
 * Que NO se puede preservar: `event_staff` (los jueces y colaboradores DE ESE
 * evento) desaparece junto con el evento al que pertenece. Un rol "de esta
 * competencia" no tiene sentido sin la competencia — ver "Un colaborador
 * tiene rol en el EVENTO, no en la organizacion" en CLAUDE.md. La cuenta del
 * juez y su lugar en `org_members` no se pierden, solo su asignacion a un
 * evento que ya no existe.
 *
 * El orden de borrado replica la logica de `borrarOrganizacion()` en
 * seed-dev.mjs: la mayoria de las tablas cuelgan de `events` con
 * `on delete cascade`, asi que basta con borrar la fila del evento al final.
 * Las unicas que necesitan un borrado explicito ANTES son las que participan
 * de una relacion `on delete restrict` cuyo padre y cuya hija mueren en la
 * MISMA cascada (ver "RESTRICT no tolera la cascada" en CLAUDE.md):
 *
 *   - `teams` / `registrations` -> `divisions` (restrict)
 *   - `heats` / `lanes` -> `workouts` (restrict)
 *   - `divisions` / `part_divisions` -> `course_templates` (restrict)
 *
 * Todo lo demas (timing_events, results, arenas, event_staff,
 * division_registration, orders, athletes, etc.) cae solo al borrar el
 * evento.
 *
 * Usa el service role: RLS no importa aca, esto no es el camino que hay que
 * probar.
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

function morir(paso, error) {
  console.error(`\n  FALLA en ${paso}:`, error?.message ?? error);
  process.exit(1);
}

async function borrarPor(tabla, columna, valor, paso) {
  const { error, count } = await db
    .from(tabla)
    .delete({ count: "exact" })
    .eq(columna, valor);
  if (error) morir(paso ?? `borrar ${tabla}`, error);
  return count ?? 0;
}

/** Borra un evento entero y todo lo que cuelga de el, en orden de dependencia. */
async function borrarEvento(eventId, nombre) {
  // 1) Libera a `divisions` de sus dos restrict.
  await borrarPor("teams", "event_id", eventId, "borrar teams");
  await borrarPor("registrations", "event_id", eventId, "borrar registrations");

  // 2) Libera a `workouts` de sus dos restrict. `lanes` cae por cascade al
  //    borrar `heats`, pero no cuesta nada ser explicito.
  await borrarPor("lanes", "event_id", eventId, "borrar lanes");
  await borrarPor("heats", "event_id", eventId, "borrar heats");

  // 3) `divisions` ya puede borrarse (sin teams ni registrations). Se lleva
  //    consigo, por cascade, a part_divisions, division_movements,
  //    division_movement_specs, division_segment_specs, division_registration,
  //    scoring_snapshots, stage_advancements y registration_fields con
  //    division_id. Eso libera a `course_templates` de sus dos restrict.
  await borrarPor("divisions", "event_id", eventId, "borrar divisions");

  // 4) `workouts` ya puede borrarse (sin heats ni lanes). Se lleva consigo,
  //    por cascade, a workout_parts, part_blocks y part_movements.
  await borrarPor("workouts", "event_id", eventId, "borrar workouts");

  // 5) `course_templates` ya puede borrarse (sin divisions ni
  //    part_divisions). Se lleva consigo, por cascade, a segments.
  await borrarPor("course_templates", "event_id", eventId, "borrar course_templates");

  // 6) El evento se lleva TODO lo que queda, por cascade: timing_events,
  //    results, result_publications, lane_audit, workout_scores,
  //    workout_score_audit, standings, arenas, event_staff,
  //    event_staff_divisions, athletes, penalty_types, orders,
  //    payment_attempts, discount_codes, event_documents.
  const { error } = await db.from("events").delete().eq("id", eventId);
  if (error) morir(`borrar el evento ${nombre}`, error);
}

console.log("Buscando organizaciones…");
const { data: orgs, error: errOrgs } = await db.from("organizations").select("id, name");
if (errOrgs) morir("listar organizaciones", errOrgs);

let totalEventos = 0;
let totalOrgs = 0;

for (const org of orgs ?? []) {
  const { data: eventos, error: errEventos } = await db
    .from("events")
    .select("id, name")
    .eq("org_id", org.id);
  if (errEventos) morir(`listar eventos de ${org.name}`, errEventos);
  if (!eventos?.length) continue;

  totalOrgs += 1;
  console.log(`\n${org.name} — ${eventos.length} competencia(s)`);
  for (const ev of eventos) {
    process.stdout.write(`   borrando "${ev.name}"… `);
    await borrarEvento(ev.id, ev.name);
    console.log("listo");
    totalEventos += 1;
  }
}

console.log(`\nListo. ${totalEventos} competencia(s) borradas en ${totalOrgs} organizacion(es).`);
console.log("Las organizaciones, sus miembros y las cuentas de usuario siguen intactas.");
