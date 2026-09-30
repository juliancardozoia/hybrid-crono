import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeReturnPath } from "@/features/auth/lib/redirect";

/** Cierra el flujo de confirmacion por email: canjea el code por una sesion. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  // El destino viaja en la URL del correo: sin sanear, un link armado a mano
  // dejaba al usuario recien autenticado en un sitio ajeno.
  const destino = sanitizeReturnPath(searchParams.get("volver"));

  // Las dos ramas de error abajo llevan `volver` al login: el intercambio de
  // codigo por sesion falla seguido cuando el link de confirmacion se abre en
  // otro navegador o dispositivo del que arranco el registro (el verificador
  // PKCE queda en una cookie de ESE navegador), o cuando el escaneo de
  // seguridad del cliente de correo pre-visita el link y gasta el codigo antes
  // de que la persona haga click. La cuenta igual queda confirmada del lado de
  // Supabase -- lo unico que falla es ESTA sesion -- asi que sin volver, quien
  // inicia sesion a mano despues de esto vuelve a caer en el destino generico
  // en vez de donde de verdad queria llegar (una inscripcion puntual).
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=sin-codigo&volver=${encodeURIComponent(destino)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link-invalido&volver=${encodeURIComponent(destino)}`);
  }

  return NextResponse.redirect(`${origin}${destino}`);
}
