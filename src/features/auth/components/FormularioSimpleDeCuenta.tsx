"use client";

import { useActionState } from "react";
import type { AuthState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";

const initial: AuthState = { error: null, message: null };

/**
 * Formulario de las dos pantallas cortas de cuenta: pedir el enlace de
 * recuperacion y elegir la contraseña nueva.
 *
 * Cuando la accion responde con `message` el formulario DESAPARECE y queda solo
 * el mensaje. En "te mandamos un correo" volver a mostrar el boton invita a
 * apretarlo de nuevo, y cada intento manda otro mail y acerca el limite de
 * envios de Supabase — el usuario termina sin ningun correo por haber pedido
 * tres.
 */
export function FormularioSimpleDeCuenta({
  action,
  submitLabel,
  esperando,
  children,
}: {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  esperando: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initial);

  if (state.message) {
    return (
      <p
        role="status"
        className="rounded-xl border border-lime-500/40 bg-lime-500/10 p-4 text-sm leading-relaxed text-lime-200"
      >
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {children}

      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {state.error}
        </p>
      )}

      <BotonDeEnvio
        pendienteTexto={esperando}
        mensajeDeCarga={esperando}
        className="w-full rounded-xl bg-lime-400 py-3.5 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
      >
        {submitLabel}
      </BotonDeEnvio>
    </form>
  );
}
