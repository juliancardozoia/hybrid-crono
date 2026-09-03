import { createClient } from "@/lib/supabase/server";

/**
 * El perfil de quien esta con sesion abierta.
 *
 * UN CORREO, DOS PERFILES. La misma cuenta compite y organiza: no hay dos
 * registros, ni un "tipo de usuario" que haya que elegir en la puerta. Alguien
 * que se anota a una competencia y despues decide armar la suya no se registra
 * de nuevo, y un organizador que quiere competir tampoco.
 *
 * Por eso no existe una columna `rol` en `profiles`: el rol no es del usuario,
 * es del CONTEXTO. Se es organizador de las competencias propias y competidor
 * de aquellas en las que uno se inscribio, al mismo tiempo.
 */
export interface Perfil {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  phoneCountry: string | null;
  phone: string | null;
  birthDate: string | null;
  country: string | null;
  city: string | null;
  instagram: string | null;
}

export async function getPerfil(): Promise<Perfil | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, phone_country, phone, birth_date, country, city, instagram")
    .eq("id", user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: data?.email ?? user.email ?? "",
    fullName: data?.full_name ?? null,
    avatarUrl: data?.avatar_url ?? null,
    phoneCountry: data?.phone_country ?? null,
    phone: data?.phone ?? null,
    birthDate: data?.birth_date ?? null,
    country: data?.country ?? null,
    city: data?.city ?? null,
    instagram: data?.instagram ?? null,
  };
}

/**
 * Cuantas competencias organiza y en cuantas compite.
 *
 * Es lo que decide que ofrecer al entrar: quien nunca organizo nada ve un
 * "crear competencia" grande en vez de una lista vacia.
 */
export async function getResumenDeCuenta(): Promise<{
  organiza: number;
  compite: number;
}> {
  const supabase = await createClient();

  const [{ count: organiza }, { count: compite }] = await Promise.all([
    // RLS ya limita a lo que este usuario puede ver: no hace falta filtrar.
    supabase.from("events").select("id", { count: "exact", head: false }).limit(1),
    supabase.from("registrations").select("id", { count: "exact", head: false }).limit(1),
  ]);

  return { organiza: organiza ?? 0, compite: compite ?? 0 };
}
