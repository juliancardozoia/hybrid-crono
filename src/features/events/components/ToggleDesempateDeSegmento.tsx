"use client";

import { useTransition } from "react";
import { marcarSegmentoDeDesempate } from "../config/actions";
import { useNotificaciones } from "@/shared/components/Notificaciones";

/**
 * El checkbox "Desempate" de un segmento del circuito.
 *
 * Un solo segmento por PLANTILLA a la vez: activar este apaga cualquier otro
 * de la MISMA plantilla, sin que el cliente tenga que saber cual era -- lo
 * resuelve `marcar_segmento_de_desempate` en una sola transaccion (y lo
 * garantiza ademas un indice unico parcial en la base). Por eso alcanza con
 * refrescar la pagina entera al terminar: no hay estado local que
 * sincronizar entre segmentos hermanos.
 */
export function ToggleDesempateDeSegmento({
  eventId,
  segmentId,
  activo,
}: {
  eventId: string;
  segmentId: string;
  activo: boolean;
}) {
  const [pendiente, startTransition] = useTransition();
  const { error: avisarError } = useNotificaciones();

  return (
    <label
      className="flex items-center gap-1.5 text-xs text-neutral-500"
      title="El tiempo acumulado al cerrar este segmento se usa para separar un empate en esta categoria."
    >
      <input
        type="checkbox"
        checked={activo}
        disabled={pendiente}
        onChange={(e) => {
          const nuevoValor = e.target.checked;
          startTransition(async () => {
            const r = await marcarSegmentoDeDesempate(eventId, segmentId, nuevoValor);
            if (r.error) avisarError(r.error);
          });
        }}
        className="h-3.5 w-3.5 rounded border-neutral-700 bg-transparent accent-lime-400"
      />
      Desempate
    </label>
  );
}
