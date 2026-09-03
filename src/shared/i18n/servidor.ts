import "server-only";

import { cookies, headers } from "next/headers";
import {
  COOKIE_DE_IDIOMA,
  IDIOMA_POR_DEFECTO,
  esIdioma,
  idiomaDeCabecera,
  type Idioma,
} from "./idiomas";
import { crearTraductor, type Traducir } from "./diccionario";

/**
 * El idioma de esta visita.
 *
 * El orden importa: primero lo que la persona ELIGIO, y solo si no eligio nada
 * lo que dice su navegador. Al reves, cambiar de idioma no duraria mas que un
 * click en cualquier navegador configurado en otra lengua.
 */
export async function idiomaActual(): Promise<Idioma> {
  const elegido = (await cookies()).get(COOKIE_DE_IDIOMA)?.value;
  if (esIdioma(elegido)) return elegido;

  const negociado = idiomaDeCabecera((await headers()).get("accept-language"));
  return negociado ?? IDIOMA_POR_DEFECTO;
}

/** Idioma y traductor, que es lo que necesita casi cualquier pagina. */
export async function traduccion(): Promise<{ idioma: Idioma; t: Traducir }> {
  const idioma = await idiomaActual();
  return { idioma, t: crearTraductor(idioma) };
}
