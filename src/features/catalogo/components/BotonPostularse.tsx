"use client";

import { useActionState } from "react";
import { postularseComoJuez, type PostulacionState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";

const inicial: PostulacionState = { error: null, enviada: false };

export function BotonPostularse({ slug }: { slug: string }) {
  const [state, formAction] = useActionState(postularseComoJuez, inicial);

  if (state.enviada) {
    return (
      <p className="text-sm text-amber-400">
        Postulación enviada. Queda pendiente de aprobación.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="slug" value={slug} />
      <BotonDeEnvio
        pendienteTexto="Enviando…"
        mensajeDeCarga="Enviando la postulación…"
        className="shrink-0 rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
      >
        Postularme como juez
      </BotonDeEnvio>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
    </form>
  );
}
