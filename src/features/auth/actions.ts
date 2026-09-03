"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/shared/utils/appUrl";
import { sanitizeReturnPath } from "./lib/redirect";

export interface AuthState {
  error: string | null;
  message?: string | null;
}

/**
 * Los mensajes de error se devuelven traducidos y sin detalle tecnico. Decirle
 * al usuario "Invalid login credentials" no ayuda, y distinguir entre "no
 * existe" y "clave incorrecta" le regala a un atacante un enumerador de mails.
 */
function traducir(mensaje: string): string {
  if (/invalid login credentials/i.test(mensaje)) return "Email o contraseña incorrectos.";
  if (/email not confirmed/i.test(mensaje)) return "Falta confirmar tu email. Revisa tu correo.";
  if (/user already registered/i.test(mensaje)) return "Ya existe una cuenta con ese email.";
  if (/password/i.test(mensaje) && /least/i.test(mensaje)) {
    return "La contraseña tiene que tener al menos 8 caracteres.";
  }
  if (/rate limit/i.test(mensaje)) return "Demasiados intentos. Espera un momento.";
  return "No se pudo completar la operación. Intenta de nuevo.";
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // Saneado: `volver` viaja en la URL, asi que lo controla quien arme el link.
  const volver = sanitizeReturnPath(String(formData.get("volver") ?? ""));

  if (!email || !password) {
    return { error: "Completa email y contraseña." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: traducir(error.message) };

  redirect(volver);
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Completa email y contraseña." };
  }
  if (password.length < 8) {
    return { error: "La contraseña tiene que tener al menos 8 caracteres." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // En Vercel sale del dominio del deploy: un link a localhost en el mail
      // de confirmacion no lo puede abrir nadie.
      emailRedirectTo: absoluteUrl("/auth/callback"),
    },
  });

  if (error) return { error: traducir(error.message) };

  // Con confirmacion por email activada no viene sesion todavia.
  if (!data.session) {
    return {
      error: null,
      message: "Te mandamos un email para confirmar la cuenta. Revisa tu correo.",
    };
  }

  redirect("/panel");
}

/**
 * Entrar con Google.
 *
 * `signInWithOAuth` NO redirige por su cuenta desde el servidor: devuelve la URL
 * del proveedor y hay que mandar ahi al navegador a mano. Es una accion de
 * servidor justamente para que el `redirect` sea del servidor y no un
 * `window.location` del cliente: asi el flujo funciona igual con JavaScript
 * a medio cargar.
 *
 * El proveedor tiene que estar habilitado en el panel de Supabase
 * (Authentication -> Providers -> Google) con su client id y su secreto. Si no
 * lo esta, Supabase devuelve error y aca se traduce en vez de dejar al usuario
 * mirando una pantalla en blanco.
 */
export async function signInWithGoogle(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const volver = sanitizeReturnPath(String(formData.get("volver") ?? ""));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      // El destino viaja en la URL de callback porque el ida y vuelta con
      // Google pierde todo lo demas.
      redirectTo: absoluteUrl(`/auth/callback?volver=${encodeURIComponent(volver)}`),
    },
  });

  if (error || !data?.url) {
    return {
      error:
        "No se pudo abrir el ingreso con Google. Prueba con tu email y contraseña.",
    };
  }

  redirect(data.url);
}

/**
 * Manda el correo para restablecer la contraseña.
 *
 * SIEMPRE responde lo mismo, exista o no la cuenta. Decir "no hay cuenta con
 * ese email" convierte esta pantalla en un enumerador de usuarios: se prueban
 * mil correos y se sabe cuales estan registrados. Es la misma razon por la que
 * el login no distingue entre "no existe" y "clave incorrecta".
 */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Escribe tu email." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl("/auth/callback?volver=/nueva-clave"),
  });

  return {
    error: null,
    message:
      "Si hay una cuenta con ese email, te mandamos un enlace para cambiar la contraseña. Revisa tu correo.",
  };
}

/**
 * Cambia la contraseña de quien ya entro por el enlace del correo.
 *
 * No pide la contraseña anterior a proposito: quien llega aca lo hace con una
 * sesion recien creada por el enlace, y pedirle la que olvido no tendria
 * sentido. La barrera es el acceso a la casilla.
 */
export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const repetida = String(formData.get("password2") ?? "");

  if (password.length < 8) {
    return { error: "La contraseña tiene que tener al menos 8 caracteres." };
  }
  if (password !== repetida) return { error: "Las dos contraseñas no coinciden." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "El enlace venció o ya se usó. Pide uno nuevo desde “Olvidé mi contraseña”.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: traducir(error.message) };

  redirect("/panel");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
