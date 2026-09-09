"use client";

import { useTransition } from "react";
import { recalcularGeneral } from "../actions";
import { Boton } from "@/shared/components/Boton";
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
    <Boton
      variante="secondary"
      compacto
      cargando={pendiente}
      textoCargando="Recalculando…"
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
    >
      Recalcular tabla general
    </Boton>
  );
}
