"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface FormState {
  error: string | null;
  message?: string | null;
}

const OK: FormState = { error: null, message: "Datos guardados." };

/**
 * Guarda el perfil del competidor.
 *
 * Solo se escriben los campos del formulario, nunca el `id` ni el correo: el
 * correo lo gobierna el sistema de autenticacion y cambiarlo desde aqui dejaria
 * el perfil apuntando a una cuenta con la que ya no se puede entrar.
 */
export async function guardarPerfil(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Hay que iniciar sesión." };

  const texto = (campo: string) => String(formData.get(campo) ?? "").trim() || null;

  const nombre = texto("fullName");
  if (!nombre) return { error: "Escribe tu nombre." };

  const pais = texto("country");
  if (pais && !/^[A-Z]{2}$/.test(pais)) return { error: "El país no es válido." };

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: nombre,
      phone_country: texto("phoneCountry"),
      phone: texto("phone"),
      birth_date: texto("birthDate"),
      country: pais,
      city: texto("city"),
      // Se guarda sin arroba: la pantalla lo pinta y asi no quedan "@@juan".
      instagram: texto("instagram")?.replace(/^@/, "") ?? null,
    })
    .eq("id", user.id);

  if (error) return { error: error.message || "No se pudo guardar." };

  revalidatePath("/cuenta");
  revalidatePath("/", "layout");
  return OK;
}

/**
 * Deja registrada la foto que el navegador acaba de subir.
 *
 * EL ARCHIVO NO PASA POR AQUI. Lo sube el navegador directo a Storage con la
 * sesion del usuario, y la politica del bucket exige que la carpeta se llame
 * como su uuid. Mandar la imagen a una server action significaria cargarla
 * entera en memoria del servidor para reenviarla: mas lento, mas caro, y con un
 * limite de tamaño de payload que no controlamos.
 *
 * Lo que si pasa por aqui es la URL, y por eso se valida que apunte al bucket de
 * avatares: sin eso, cualquiera podria dejar en su perfil la URL de un dominio
 * ajeno y usar el leaderboard publico para rastrear quien lo mira.
 */
export async function guardarAvatar(url: string): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Hay que iniciar sesión." };

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.startsWith(`${base}/storage/v1/object/public/avatars/`)) {
    return { error: "Esa imagen no es válida." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: url })
    .eq("id", user.id);

  if (error) return { error: error.message || "No se pudo guardar la foto." };

  revalidatePath("/cuenta");
  revalidatePath("/", "layout");
  return { error: null };
}
