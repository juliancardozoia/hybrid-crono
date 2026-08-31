import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";
import { supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from "./env";

/**
 * Cliente para server components, route handlers y server actions.
 *
 * Sigue actuando como el usuario logueado: RLS se aplica igual que en el
 * navegador. Estar en el servidor no otorga privilegios.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Los server components no pueden escribir cookies. El middleware ya
          // refresco la sesion, asi que ignorarlo aca es correcto.
        }
      },
    },
  });
}

/**
 * Cliente con service role: SALTEA RLS por completo.
 *
 * Solo para trabajo de servidor que legitimamente no tiene un usuario detras,
 * como recalcular resultados tras una ingesta. Nunca lo expongas a una ruta que
 * reciba input del usuario sin verificar permisos vos mismo primero.
 */
export function createServiceClient() {
  return createServerClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
