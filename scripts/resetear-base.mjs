/**
 * Deja la base como recien instalada: cero organizaciones, cero competencias,
 * cero cuentas de usuario, cero archivos en Storage. Las migraciones quedan
 * intactas (esto no toca el esquema, solo los datos).
 *
 *   node scripts/resetear-base.mjs "BORRAR TODO"
 *   npm run resetear:base -- "BORRAR TODO"
 *
 * La confirmacion es un ARGUMENTO, no un prompt interactivo leido de stdin.
 * Se probo con `readline` primero y el "BORRAR TODO" jamas llegaba a
 * compararse bien al correr por `npm run` en Windows/PowerShell: npm envuelve
 * el proceso y en esa cadena stdin no se reenvia como una terminal real, asi
 * que `rl.question()` se resuelve con una linea vacia y el script cancela
 * solo, sin importar lo que la persona haya tipeado. Pedirlo como argumento
 * saca a stdin de la ecuacion — sigue habiendo que escribir la frase exacta a
 * mano, pero ya no depende de como cada shell reenvia el teclado.
 *
 * Orden de borrado, y por que en ese orden exacto:
 *
 *   1) Cada EVENTO, uno por uno, con el mismo orden de dependencia que ya usan
 *      `seed-dev.mjs` y `borrar-competencias.mjs` (documentado en CLAUDE.md,
 *      "RESTRICT no tolera la cascada"). No alcanza con borrar
 *      `organizations` y dejar que el cascade se lleve todo: hay FKs
 *      `on delete restrict` cuyo padre y cuya hija mueren en la MISMA
 *      cascada (teams/registrations -> divisions, heats/lanes -> workouts,
 *      divisions/part_divisions -> course_templates), y RESTRICT se
 *      comprueba INMEDIATAMENTE, antes de que la cascada llegue a la hija.
 *   2) Las ORGANIZACIONES. Con los eventos ya afuera, lo que cuelga de una
 *      organizacion (org_members, payment_providers, billing_accounts,
 *      invitations, movements con org_id propio) cae por cascade sin
 *      ningun restrict de por medio.
 *   3) Los archivos de STORAGE (`avatars`, `eventos`). No son filas de
 *      Postgres: hay que borrarlos aparte o quedan huerfanos ocupando
 *      espacio sin que ninguna fila los referencie.
 *   4) Las CUENTAS de `auth.users`, por la API de administracion (no se
 *      puede hacer con un DELETE de tabla). `profiles` cae sola por
 *      `on delete cascade`. Van AL FINAL a proposito: `registrations.created_by`
 *      y `timing_events.recorded_by` son `on delete restrict` contra
 *      `auth.users`, y esas filas recien desaparecieron en el paso 1.
 *
 * Lo unico que sobrevive: el catalogo global de movimientos (`movements` con
 * `org_id` null) y cualquier tabla de referencia que no cuelgue de una
 * organizacion, un evento o una cuenta — son datos de fabrica, no datos de
 * uso.
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

// ---------------------------------------------------------------------------
// Confirmacion: esto borra TODO, sin vuelta atras. Se pide como ARGUMENTO
// (no como prompt de stdin) — ver el comentario del encabezado.

const FRASE = "BORRAR TODO";
const confirmacion = process.argv[2];

if (confirmacion !== FRASE) {
  console.log("Esto va a borrar TODA la base de datos, sin dejar nada:");
  console.log(`  Proyecto: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log("  - todas las organizaciones y sus competencias");
  console.log("  - todos los cronometrajes, resultados e inscripciones");
  console.log("  - todas las cuentas de usuario registradas");
  console.log("  - todos los archivos subidos (logos, documentos, fotos de perfil)");
  console.log("\nNo se puede deshacer.\n");
  console.log(`Para confirmar, volve a correrlo pasando la frase exacta como argumento:\n`);
  console.log(`  node scripts/resetear-base.mjs "${FRASE}"`);
  console.log(`  npm run resetear:base -- "${FRASE}"`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) Eventos, uno por uno, en orden de dependencia.

async function borrarPor(tabla, columna, valor, paso) {
  const { error } = await db.from(tabla).delete().eq(columna, valor);
  if (error) morir(paso ?? `borrar ${tabla}`, error);
}

/** Misma logica que `borrarEvento()` en borrar-competencias.mjs. */
async function borrarEvento(eventId, nombre) {
  await borrarPor("teams", "event_id", eventId, "borrar teams");
  await borrarPor("registrations", "event_id", eventId, "borrar registrations");
  await borrarPor("lanes", "event_id", eventId, "borrar lanes");
  await borrarPor("heats", "event_id", eventId, "borrar heats");
  await borrarPor("divisions", "event_id", eventId, "borrar divisions");
  await borrarPor("workouts", "event_id", eventId, "borrar workouts");
  await borrarPor("course_templates", "event_id", eventId, "borrar course_templates");
  const { error } = await db.from("events").delete().eq("id", eventId);
  if (error) morir(`borrar el evento ${nombre}`, error);
}

console.log("\nBorrando competencias…");
const { data: eventos, error: errEventos } = await db.from("events").select("id, name");
if (errEventos) morir("listar eventos", errEventos);
for (const ev of eventos ?? []) {
  process.stdout.write(`   "${ev.name}"… `);
  await borrarEvento(ev.id, ev.name);
  console.log("listo");
}
console.log(`Listo: ${eventos?.length ?? 0} competencia(s) borradas.`);

// ---------------------------------------------------------------------------
// 2) Organizaciones (ya sin eventos, el cascade no pega contra ningun
//    restrict).

console.log("\nBorrando organizaciones…");
const { data: orgs, error: errOrgs } = await db.from("organizations").select("id, name");
if (errOrgs) morir("listar organizaciones", errOrgs);
for (const org of orgs ?? []) {
  const { error } = await db.from("organizations").delete().eq("id", org.id);
  if (error) morir(`borrar la organizacion ${org.name}`, error);
}
console.log(`Listo: ${orgs?.length ?? 0} organizacion(es) borradas.`);

// ---------------------------------------------------------------------------
// 3) Archivos de Storage.

/** Todas las rutas de ARCHIVO (nunca carpetas) bajo un prefijo, recursivo:
 * no se puede asumir un solo nivel de anidamiento (`eventos` tiene
 * `<eventId>/documentos/...`, `avatars` es plano). */
async function listarArchivos(bucket, prefijo) {
  const { data: items, error } = await db.storage.from(bucket).list(prefijo, { limit: 1000 });
  if (error) morir(`listar ${bucket}/${prefijo}`, error);

  const rutas = [];
  for (const item of items ?? []) {
    const ruta = prefijo ? `${prefijo}/${item.name}` : item.name;
    if (item.id === null) {
      // Carpeta: Storage no la lista como archivo, hay que bajar un nivel.
      rutas.push(...(await listarArchivos(bucket, ruta)));
    } else {
      rutas.push(ruta);
    }
  }
  return rutas;
}

async function vaciarBucket(bucket) {
  const rutas = await listarArchivos(bucket, "");
  if (!rutas.length) return 0;

  // Storage rechaza un remove() con demasiadas rutas de una: de a 100.
  for (let i = 0; i < rutas.length; i += 100) {
    const { error } = await db.storage.from(bucket).remove(rutas.slice(i, i + 100));
    if (error) morir(`borrar archivos de ${bucket}`, error);
  }
  return rutas.length;
}

console.log("\nVaciando archivos subidos…");
for (const bucket of ["eventos", "avatars"]) {
  const cantidad = await vaciarBucket(bucket);
  console.log(`   ${bucket}: ${cantidad} archivo(s) borrados.`);
}

// ---------------------------------------------------------------------------
// 4) Cuentas de usuario. Al final: timing_events.recorded_by y
//    registrations.created_by son restrict contra auth.users, y esas filas
//    ya no existen desde el paso 1.

console.log("\nBorrando cuentas de usuario…");
let totalUsuarios = 0;
for (;;) {
  const { data: pagina, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) morir("listar usuarios", error);
  if (!pagina?.users?.length) break;
  for (const u of pagina.users) {
    const { error: errBorrar } = await db.auth.admin.deleteUser(u.id);
    if (errBorrar) morir(`borrar la cuenta ${u.email}`, errBorrar);
    totalUsuarios += 1;
  }
}
console.log(`Listo: ${totalUsuarios} cuenta(s) borradas.`);

console.log("\nBase reseteada. Queda como recien instalada.");
console.log('Para volver a tener datos de prueba: "npm run seed:dev".');
