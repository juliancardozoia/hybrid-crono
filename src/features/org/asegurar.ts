import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * La organizacion del usuario, creandola si todavia no tiene.
 *
 * POR QUE ESTO REEMPLAZA A UNA PANTALLA ENTERA
 *
 * Antes, quien se registraba para organizar caia en un "crea tu organizacion"
 * antes de poder hacer nada. La organizacion es un concepto INTERNO —el espacio
 * donde viven los eventos, los atletas y los carriles, y el sujeto de casi todas
 * las politicas de RLS— que no le importa a nadie el primer dia. Pedirla por
 * adelantado es cobrar una decision que el usuario todavia no puede tomar.
 *
 * Sigue existiendo y sigue siendo la base de la seguridad; lo unico que cambia
 * es que la crea el sistema. El usuario no ve la palabra hasta que quiera
 * invitar a alguien.
 *
 * La funcion de Postgres es idempotente: entrar diez veces no crea diez
 * espacios.
 */
export async function asegurarOrganizacion(): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_my_organization");

  if (error || !data) return null;

  const org = data as unknown as { id: string; name: string };
  return { id: org.id, name: org.name };
}
