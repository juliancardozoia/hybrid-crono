/**
 * Banco de pruebas para las migraciones.
 *
 * Levanta un Postgres real en proceso (PGlite) y le aplica las migraciones tal
 * como las va a aplicar Supabase. Sirve para dos cosas que a ojo no se pueden
 * verificar: que el SQL efectivamente corre, y que las politicas RLS bloquean
 * lo que tienen que bloquear.
 *
 * Detalle que hace o rompe estos tests: PGlite corre como superusuario, y los
 * superusuarios SALTEAN RLS. Si ejecutaramos asi, cada test pasaria sin probar
 * nada. Por eso el harness replica los roles de Supabase y corre como
 * `authenticated`, que es el rol real de un usuario logueado.
 */

import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Lo que Supabase ya trae puesto y las migraciones dan por sentado.
 * `auth.uid()` es identica a la de Supabase: lee el sub del JWT de la sesion.
 */
const SUPABASE_STUB = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    -- Supabase guarda aca lo que se manda en options.data al registrarse.
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );

  create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;

  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  grant usage on schema public, auth to anon, authenticated, service_role;
  grant select on auth.users to authenticated, service_role;

  -- CRITICO para que estos tests sirvan de algo.
  --
  -- Supabase aplica esto sobre el schema public al crear el proyecto, asi que
  -- TODA tabla nueva nace con permisos completos para anon y authenticated. Un
  -- \`grant select, insert\` en una migracion es ADITIVO: no le quita nada a
  -- nadie.
  --
  -- Sin esta linea el harness era mas restrictivo que la produccion, y los
  -- tests pasaban afirmando garantias que en el proyecto real no existian.
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;
`;

export type TestDb = PGlite;

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  if (files.length === 0) {
    throw new Error(`No hay migraciones en ${MIGRATIONS_DIR}`);
  }

  for (const file of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Fallo la migracion ${file}: ${(error as Error).message}`);
    }
  }

  return db;
}

/** Crea un usuario en auth.users y devuelve su id. */
export async function createUser(db: TestDb, email: string, fullName?: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id",
    [email, JSON.stringify(fullName ? { full_name: fullName } : {})],
  );
  return res.rows[0].id;
}

/**
 * Corre `fn` como si fuera ese usuario logueado: rol `authenticated` y el sub
 * del JWT apuntando a su id. Es la unica forma de que RLS realmente se aplique.
 */
export async function asUser<T>(
  db: TestDb,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec("set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/**
 * Corre `fn` como visitante anonimo, el rol real de alguien que abre el
 * leaderboard publico sin cuenta.
 *
 * Ojo: NO es lo mismo que asUser(db, null). Aquel es el rol `authenticated` sin
 * usuario, que si tiene GRANTs sobre las tablas y solo lo frena RLS. `anon` no
 * tiene ningun grant, que es la barrera que de verdad queremos verificar.
 */
export async function asAnon<T>(db: TestDb, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role anon;");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
  }
}

/** Corre `fn` con privilegios de servidor (saltea RLS), para preparar escenarios. */
export async function asAdmin<T>(db: TestDb, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role;");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  return fn();
}

/** Espera que la operacion sea rechazada por RLS o por permisos. */
export async function expectDenied(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Se esperaba que RLS rechazara la operacion, pero paso.");
}
