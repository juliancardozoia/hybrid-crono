/**
 * Saneado del destino post-login.
 *
 * El parametro `volver` viaja en la URL, asi que lo controla quien arme el link.
 * Sin sanear, un `volver=//sitio-malicioso.com` es una redireccion abierta: el
 * navegador trata `//host` como URL protocolo-relativa y se va del sitio. Basta
 * con mandarle ese link a un juez para sacarlo de la app despues de que ponga
 * su contraseña.
 */

const DESTINO_POR_DEFECTO = "/panel";

export function sanitizeReturnPath(
  raw: string | null | undefined,
  porDefecto = DESTINO_POR_DEFECTO,
): string {
  if (!raw) return porDefecto;

  const valor = raw.trim();

  // Tiene que ser una ruta interna: una sola barra al principio.
  if (!valor.startsWith("/")) return porDefecto;

  // `//host` y `/\host` son protocolo-relativas: salen del sitio.
  if (valor.startsWith("//") || valor.startsWith("/\\")) return porDefecto;

  // Un esquema embebido tampoco: `/javascript:alert(1)` y compania.
  if (/^\/+\w+:/.test(valor)) return porDefecto;

  return valor;
}
