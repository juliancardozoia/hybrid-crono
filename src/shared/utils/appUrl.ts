import "server-only";

/**
 * URL base de la aplicacion, para armar links absolutos.
 *
 * Hace falta en dos lugares donde una URL equivocada rompe algo visible:
 * los QR que se imprimen y se pegan en los dorsales, y el link de confirmacion
 * que llega por email al registrarse.
 *
 * El orden de preferencia no es arbitrario:
 *
 *   1. NEXT_PUBLIC_APP_URL   — el dominio propio, cuando lo haya
 *   2. produccion de Vercel  — estable entre deploys
 *   3. deploy de Vercel      — cambia en cada preview, pero sirve para probar
 *   4. localhost             — desarrollo
 *
 * Sin el paso 2, un QR impreso con la URL de un deploy de preview deja de
 * funcionar en el siguiente deploy: el atleta escanea el dorsal y no llega a
 * ningun lado.
 */
export function appUrl(): string {
  const explicita = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicita) return sinBarraFinal(explicita);

  const produccion = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (produccion) return `https://${sinBarraFinal(produccion)}`;

  const deploy = process.env.VERCEL_URL?.trim();
  if (deploy) return `https://${sinBarraFinal(deploy)}`;

  return "http://localhost:3000";
}

function sinBarraFinal(url: string): string {
  return url.replace(/\/+$/, "");
}

/** URL absoluta de una ruta de la app. */
export function absoluteUrl(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
