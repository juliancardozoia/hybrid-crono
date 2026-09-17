import { NextResponse, type NextRequest } from "next/server";
import { getEventAccess } from "@/features/events/lib/access";
import { guardarCompetenciaActual } from "@/features/panel/lib/competenciaActual";

/**
 * "Resumen" (la vieja pestaña) y "Config Competencia" (la barra lateral)
 * llevan las dos aca. Ya no renderiza nada -- el panorama vive en `/panel`
 * desde que se movio ahi (ver `PanoramaDeCompetencia`) -- asi que esto es
 * GATE + REDIRECT puro: valida acceso, marca la competencia como la
 * "actual", y manda para atras.
 *
 * ES UN ROUTE HANDLER, NO UNA PAGINA, a proposito. `cookies().set()` -- lo
 * que hace falta para "marcar como actual" (`guardarCompetenciaActual`) --
 * solo se puede llamar desde una Server Action, un Route Handler o
 * Middleware. Esto ERA un `page.tsx` que llamaba a `elegirCompetencia()`
 * ("use server") directo desde su propio render, y reventaba con "Cookies
 * can only be modified in a Server Action or Route Handler": un `page.tsx`
 * renderiza DENTRO del arbol de React, y ahi ese llamado es una funcion mas
 * ejecutandose en fase de render, no una invocacion real de Server Action —
 * aunque la funcion este anotada `"use server"`.
 *
 * El selector de competencias del header SI puede seguir llamando a
 * `elegirCompetencia()` (misma cookie, mismo redirect, en
 * `src/features/panel/actions.ts`) porque lo invoca un componente de
 * CLIENTE: eso pasa por el mecanismo real de Server Actions de Next -- una
 * peticion de verdad, no una llamada de funcion en medio de un render -- que
 * es la otra puerta permitida.
 *
 * `getEventAccess()` y no `requireEventAccess()`: aquella hace
 * `redirect()` (de `next/navigation`) al fallar, y ese helper es para
 * Server Components/Actions -- exactamente la misma familia de restriccion
 * que este archivo existe para evitar. Aca el rechazo se resuelve con un
 * `NextResponse.redirect` comun, como ya hace `auth/callback/route.ts`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const acceso = await getEventAccess(id);

  if (acceso) {
    await guardarCompetenciaActual(id);
  }

  return NextResponse.redirect(new URL("/panel", request.nextUrl.origin));
}
