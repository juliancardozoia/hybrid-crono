"use client";

import { useState, useTransition } from "react";
import { cambiarModoDeCaptura } from "../actions";
import { useCargaMientras } from "@/shared/components/Carga";
import type { CaptureMode } from "@/lib/supabase/types";

/**
 * Como se puntua esta prueba: cargando el resultado a mano, o juzgandola en
 * vivo con la app del juez.
 *
 * NO va dentro de un `<form action={...}>`. Es el caso del bug de HeatCard: al
 * terminar la accion React llama al `form.reset()` nativo y el control vuelve a
 * lo que estaba, aunque el estado diga otra cosa. Aquí encima la eleccion puede
 * ser RECHAZADA por el servidor (el plan gratuito no juzga WODs en vivo), asi
 * que hay dos motivos para manejar la transicion a mano y mostrar el mensaje.
 */
export function ModoDeCaptura({
  eventId,
  partId,
  actual,
  bloqueado,
}: {
  eventId: string;
  partId: string;
  actual: CaptureMode;
  /** El plan no habilita el vivo: se muestra igual, deshabilitado y explicado. */
  bloqueado: boolean;
}) {
  const [modo, setModo] = useState<CaptureMode>(actual);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  useCargaMientras(pendiente, "Cambiando el modo de captura…");

  function elegir(nuevo: CaptureMode) {
    if (nuevo === modo) return;
    const previo = modo;
    setModo(nuevo);
    setError(null);
    startTransition(async () => {
      const res = await cambiarModoDeCaptura(eventId, partId, nuevo);
      if (res.error) {
        // Volver a lo que habia: dejarlo marcado seria mentirle al organizador
        // sobre lo que quedo guardado.
        setModo(previo);
        setError(res.error);
      }
    });
  }

  const OPCIONES: Array<{
    valor: CaptureMode;
    titulo: string;
    detalle: string;
  }> = [
    {
      valor: "manual",
      titulo: "A mano",
      detalle:
        "Alguien carga el resultado al terminar, desde la pestaña Cargar.",
    },
    {
      valor: "en_vivo",
      titulo: "Juzgada en vivo",
      detalle: "Un juez cuenta las repeticiones con el celular, offline.",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {OPCIONES.map((o) => {
          const activo = modo === o.valor;
          const noDisponible = o.valor === "en_vivo" && bloqueado;
          return (
            <button
              key={o.valor}
              type="button"
              onClick={() => elegir(o.valor)}
              disabled={pendiente || noDisponible}
              className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
                activo
                  ? "border-lime-400 bg-lime-400/10"
                  : "border-neutral-700 hover:border-neutral-600"
              }`}
            >
              <span className="block text-sm font-medium">{o.titulo}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {o.detalle}
              </span>
              {noDisponible && (
                <span className="mt-1 block text-xs text-neutral-600">
                  Plan Pro
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
