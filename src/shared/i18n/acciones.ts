"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
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

  revalidatePath("/", "layout");
}
