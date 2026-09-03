"use client";

import { useActionState } from "react";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { FormState } from "../actions";

/**
 * Boton que dispara un cambio de plan y muestra lo que responde el servidor.
 *
 * Existe separado de `SimpleForm` por el error: cuando el servidor rechaza el
 * cambio —"no se puede volver al gratuito con la Copa en curso"— ese texto es lo
 * unico util de la pantalla, y tiene que quedar al lado del boton que lo
 * provoco, no arriba de todo.
 */
export function BotonDePlan({
  accion,
  orgId,
  etiqueta,
  tono = "principal",
}: {
  accion: (prev: FormState, formData: FormData) => Promise<FormState>;
  orgId: string;
  etiqueta: string;
  tono?: "principal" | "discreto";
}) {
  const [state, formAction] = useActionState(accion, {
    error: null,
  } as FormState);

  const clase =
    tono === "principal"
      ? "bg-lime-400 font-bold text-lime-950 hover:bg-lime-300"
      : "border border-neutral-700 text-neutral-300 hover:bg-neutral-900";

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <BotonDeEnvio
        pendienteTexto="…"
        mensajeDeCarga="Cambiando el plan…"
        className={`self-start rounded-xl px-5 py-2.5 text-sm transition-colors disabled:opacity-60 ${clase}`}
      >
        {etiqueta}
      </BotonDeEnvio>
      {state.error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
