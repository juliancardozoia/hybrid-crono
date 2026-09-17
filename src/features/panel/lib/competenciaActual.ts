import "server-only";

import { cookies } from "next/headers";

/**
 * Que competencia mostrar en /panel cuando el organizador tiene mas de una.
 *
 * Misma idea que `COOKIE_DE_IDIOMA`: lo que la persona ELIGIO en el selector
 * pesa mas que cualquier calculo automatico. Sin esto, /panel tendria que
 * adivinar cual mostrar cada vez -- la mas reciente, la que esta en vivo -- y
 * el organizador que dejo el switcher en "Session #02" volveria a caer en
 * "Session #01" con cada visita.
 */
export const COOKIE_COMPETENCIA_ACTUAL = "competencia_actual";
const DURACION_COOKIE = 60 * 60 * 24 * 180;

export async function competenciaActualId(): Promise<string | null> {
  return (await cookies()).get(COOKIE_COMPETENCIA_ACTUAL)?.value ?? null;
}

/**
 * De la lista de competencias que el usuario organiza, cual es "la actual":
 * la de la cookie si sigue estando en la lista (pudo haberse borrado, o el
 * usuario perdio el acceso), y si no, la primera -- `listEventosQueOrganizo()`
 * ya ordena por fecha descendente, asi que "la primera" es "la mas reciente".
 *
 * Funcion PURA a proposito: la usan tanto el layout del panel (para marcar el
 * check en el selector) como `/panel` (para decidir que panorama mostrar), y
 * las dos ya tienen la lista de competencias cargada -- resolverla aca de
 * nuevo con una consulta seria repetir lo que el llamador ya sabe.
 */
export function resolverCompetenciaActualId(
  organizadas: Array<{ id: string }>,
  cookieId: string | null,
): string | null {
  if (cookieId && organizadas.some((e) => e.id === cookieId)) return cookieId;
  return organizadas[0]?.id ?? null;
}

/** Solo la usa `elegirCompetencia()` (server action) -- exportada aparte
 *  para no importar `cookies().set` en un modulo que otros archivos leen. */
export async function guardarCompetenciaActual(eventId: string): Promise<void> {
  (await cookies()).set(COOKIE_COMPETENCIA_ACTUAL, eventId, {
    maxAge: DURACION_COOKIE,
    path: "/",
    httpOnly: false,
    sameSite: "lax",
  });
}
