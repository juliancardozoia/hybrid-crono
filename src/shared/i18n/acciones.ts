"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { COOKIE_DE_IDIOMA, DURACION_COOKIE, esIdioma } from "./idiomas";

/**
 * Guarda el idioma elegido.
 *
 * Es una accion de servidor y no un `document.cookie` del cliente porque las
 * paginas se renderizan en el servidor: escribir la cookie en el navegador
 * dejaria el HTML ya pintado en el idioma anterior hasta la siguiente
 * navegacion. El `revalidatePath` vuelve a pintar todo de una.
 *
 * `httpOnly: false` a proposito: no es un secreto, y dejarla legible permite
 * que un componente de cliente sepa en que idioma esta sin otra consulta.
 */
export async function elegirIdioma(codigo: string): Promise<void> {
  if (!esIdioma(codigo)) return;

  (await cookies()).set(COOKIE_DE_IDIOMA, codigo, {
    maxAge: DURACION_COOKIE,
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });

  await guardarIdiomaEnElPerfil(codigo);

  revalidatePath("/", "layout");
}

/**
 * Recuerda el idioma en el perfil, para escribirle en ese idioma por correo.
 *
 * La cookie es lo que ve la pantalla; el correo se manda desde un trigger, sin
 * navegador de por medio, asi que necesita el dato en la base.
 *
 * Es un "extra": cambiar de idioma tiene que funcionar igual sin sesion, sin
 * red, o con la migracion todavia sin aplicar. Por eso nunca lanza ni se
 * reporta — la cookie ya quedo guardada.
 */
async function guardarIdiomaEnElPerfil(codigo: string): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("profiles")
      .update({ locale: codigo } as never)
      .eq("id", user.id);
  } catch {
    /* ver arriba */
  }
}
