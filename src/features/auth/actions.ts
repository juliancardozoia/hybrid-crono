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
  return "No se pudo completar la operación. Intentá de nuevo.";
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

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
