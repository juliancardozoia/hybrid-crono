import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * Cliente anonimo, sin cookies ni sesion.
 *
 * Para las paginas publicas (leaderboard, vista de atleta). No usa el cliente
 * con cookies a proposito: el leaderboard tiene que verse igual para todos, y
 * mezclarle la sesion del organizador solo abriria la puerta a que se filtre
 * algo que el publico no deberia ver.
 *
 * El rol anon no tiene permisos sobre ninguna tabla: lo unico que puede invocar
 * es public_leaderboard().
 */
export function createPublicClient() {
  return createSupabaseClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
