"use client";

import { useTransition } from "react";
import { recalcularGeneral } from "../actions";
import { useCarga } from "@/shared/components/Carga";
import { useNotificaciones } from "@/shared/components/Notificaciones";

/**
 * Rearma la tabla general a mano.
 *
 * Normalmente no hace falta: cada score guardado la recalcula solo. Existe para
 * el caso en que ese recalculo fallo (es fire-and-forget a proposito, para que
 * un problema del cache no impida guardar el dato) y para despues de importar
 * atletas o cambiar la tabla de puntos de una categoria.
 *
 * Antes no avisaba ni de que termino ni de que fallo — `recomputeStandings` ya
 * traia su propio `error`, pero `recalcularGeneral` lo descartaba antes de
 * devolverlo.
 */
export function RecalcularGeneral({ eventId }: { eventId: string }) {
  const [pendiente, startTransition] = useTransition();
  const { activar, desactivar } = useCarga();
  const { exito, error: avisarError } = useNotificaciones();

  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() =>
        startTransition(async () => {
          activar("Recalculando la tabla general…");
          try {
            const r = await recalcularGeneral(eventId);
            if (r.error) avisarError(r.error);
            else exito("Tabla general recalculada.");
          } finally {
            desactivar();
          }
        })
      }
      className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60"
    >
      {pendiente ? "Recalculando…" : "Recalcular tabla general"}
    </button>
  );
}
