"use server";

import { redirect } from "next/navigation";
import { guardarCompetenciaActual } from "./lib/competenciaActual";

/**
 * "Abre" una competencia: la recuerda como la actual y manda a /panel, que es
 * donde vive su panorama (`PanoramaDeCompetencia`) desde que se movio de
 * `/panel/eventos/[id]`.
 *
 * La llama el selector de competencias del header (`SelectorDeCompetencias`),
 * al elegir una de la lista -- un componente de CLIENTE, que es justo lo que
 * permite que esta funcion mute la cookie: `cookies().set()` solo vale desde
 * una Server Action invocada de verdad (por un cliente) o un Route Handler,
 * nunca desde una funcion llamada en medio del render de un Server Component.
 *
 * `/panel/eventos/[id]` (la vieja pestaña "Resumen", y "Config Competencia"
 * en la barra lateral) hace LO MISMO -- marcar la competencia como actual y
 * redirigir -- pero NO llama a esta funcion: es un Route Handler
 * (`src/app/panel/eventos/[id]/route.ts`), y ahi la cookie se guarda directo
 * con `guardarCompetenciaActual()`. Entrar por esa ruta desde un `page.tsx`
 * (como era antes) revienta con "Cookies can only be modified in a Server
 * Action or Route Handler" -- exactamente el error que un Route Handler
 * evita.
 *
 * NO valida acceso: la llama el selector, que solo ofrece competencias de
 * `listEventosQueOrganizo()`. Si de todos modos llegara un id invalido o
 * ajeno, `/panel` lo descarta solo -- `getEventAccess()` devuelve null y cae
 * al fallback -- asi que no hace falta duplicar el chequeo aca.
 */
export async function elegirCompetencia(eventId: string): Promise<never> {
  await guardarCompetenciaActual(eventId);
  redirect("/panel");
}
