import { IDIOMA_POR_DEFECTO, esIdioma, type Idioma } from "@/shared/i18n/idiomas";

/**
 * En que idioma se le escribe a alguien.
 *
 * Orden: lo que la persona eligio en su perfil > el idioma de quien la invito >
 * español. La segunda es la unica pista que existe para quien todavia no tiene
 * cuenta. Lo que NO sirve es el `idiomaActual()` de la app: refleja a quien
 * ejecuta la accion, no a quien recibe el correo.
 */
export function idiomaDeCorreo(
  idiomaDelPerfil: string | null | undefined,
  pistaDeQuienInvita: unknown,
): Idioma {
  if (esIdioma(idiomaDelPerfil)) return idiomaDelPerfil;
  if (typeof pistaDeQuienInvita === "string" && esIdioma(pistaDeQuienInvita)) {
    return pistaDeQuienInvita;
  }
  return IDIOMA_POR_DEFECTO;
}
