"use client";

import { useActionState } from "react";
import { signInWithGoogle } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { AuthState } from "../actions";

/**
 * Entrar con Google.
 *
 * VA ARRIBA DEL FORMULARIO, y no abajo como un "ademas". Para la mayoria es un
 * click contra doce caracteres bien escritos en un teclado de celular, y una
 * cuenta creada con Google nunca queda sin confirmar esperando un correo que
 * cayo en spam.
 *
 * Es un `<form>` con accion de servidor y no un `onClick`: `signInWithOAuth`
 * devuelve la URL del proveedor y el `redirect` lo hace el servidor, asi que el
 * boton funciona aunque el JavaScript todavia no haya terminado de cargar.
 */
export function BotonDeGoogle({
  volver,
  textos,
}: {
  volver?: string;
  textos: { entrar: string; abriendo: string; error: string };
}) {
  const [state, formAction] = useActionState(signInWithGoogle, {
    error: null,
    message: null,
  } as AuthState);

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction}>
        {volver && <input type="hidden" name="volver" value={volver} />}
        <BotonDeEnvio
          pendienteTexto={textos.abriendo}
          mensajeDeCarga={textos.abriendo}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 py-3 font-semibold transition-colors hover:border-neutral-600 hover:bg-neutral-800 disabled:opacity-60"
        >
          <LogoDeGoogle />
          {textos.entrar}
        </BotonDeEnvio>
      </form>
      {/* El mensaje del servidor viene en español; el de la pantalla ya esta
          traducido. Se prefiere el segundo porque el unico error posible aca es
          "el proveedor no responde", y decirlo en el idioma que la persona
          esta leyendo importa mas que el detalle. */}
      {state.error && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {textos.error}
        </p>
      )}
    </div>
  );
}

/** El logo va inline: un `<img>` a un CDN externo lo bloquea la CSP y queda un hueco. */
function LogoDeGoogle() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
