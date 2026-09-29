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

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=sin-codigo`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link-invalido`);
  }

  return NextResponse.redirect(`${origin}${destino}`);
}
