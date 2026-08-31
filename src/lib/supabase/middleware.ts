import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";
import { supabaseAnonKey, supabaseConfigured, supabaseUrl } from "./env";

/** Rutas que se sirven sin sesion. Todo lo demas exige login. */
const PUBLIC_PREFIXES = ["/login", "/registro", "/auth", "/en-vivo", "/spike", "/api/spike"];

function isPublic(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Refresca la sesion en cada request y protege las rutas privadas.
 *
 * El refresco tiene que pasar en el middleware: los server components no pueden
 * escribir cookies, asi que si el token vence ahi no hay forma de renovarlo y el
 * usuario se cae de la sesion sin motivo aparente.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // Sin Supabase configurado la app sigue andando: el spike de la fase 1 no lo
  // necesita y no queremos que un .env incompleto rompa todo.
  if (!supabaseConfigured()) return response;

  const supabase = createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() y no getSession(): getUser valida el token contra el servidor de
  // auth. getSession confia en la cookie, que el cliente puede manipular.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";

    // El destino incluye la query string y se limpia el resto de los
    // parametros. Sin la query, un juez que abre el link de su carril sin
    // sesion vuelve a /juez/carril sin el id y no puede cronometrar nada; y sin
    // limpiar, los parametros de la ruta original se filtran al login.
    const destino = pathname + request.nextUrl.search;
    url.search = "";
    url.searchParams.set("volver", destino);

    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/registro")) {
    const url = request.nextUrl.clone();
    url.pathname = "/panel";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
