"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AuthState } from "../actions";

const initial: AuthState = { error: null, message: null };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-lime-400 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
    >
      {pending ? "Un momento…" : label}
    </button>
  );
}

export function AuthForm({
  mode,
  action,
  volver,
}: {
  mode: "login" | "registro";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  volver?: string;
}) {
  const [state, formAction] = useActionState(action, initial);
  const esLogin = mode === "login";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">{esLogin ? "Entrar" : "Crear cuenta"}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {esLogin
            ? "Ingresa para gestionar tus competencias."
            : "Crea tu cuenta de organizador."}
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        {volver && <input type="hidden" name="volver" value={volver} />}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Contraseña</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={esLogin ? "current-password" : "new-password"}
            className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400"
          />
        </label>

        {state.error && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {state.error}
          </p>
        )}
        {state.message && (
          <p className="rounded-xl border border-lime-500/40 bg-lime-500/10 p-3 text-sm text-lime-300">
            {state.message}
          </p>
        )}

        <SubmitButton label={esLogin ? "Entrar" : "Crear cuenta"} />
      </form>

      <p className="text-center text-sm text-neutral-500">
        {esLogin ? (
          <>
            ¿No tienes cuenta?{" "}
            <Link href="/registro" className="text-lime-400 hover:underline">
              Regístrate
            </Link>
          </>
        ) : (
          <>
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-lime-400 hover:underline">
              Ingresa
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
