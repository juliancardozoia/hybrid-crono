"use client";

import { useTransition } from "react";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import type { FormState } from "../actions";

/**
 * Prende o apaga que un juez pueda tomar su propio carril desde /juez.
 *
 * ES UN CHECKBOX SUELTO, NO UN `<form action={...}>`. No hay nada que
 * conservar entre envíos —es un solo booleano que ya viene con su valor del
 * servidor— pero un form normal recargaría toda la sección de postulaciones
 * de abajo por un click. `startTransition` alcanza para que el servidor
 * escriba el cambio sin bloquear el checkbox.
 *
 * SIN OVERLAY GLOBAL A PROPOSITO. Es un cambio de un solo booleano con
 * feedback inmediato en el propio checkbox (se deshabilita mientras corre);
 * opacar toda la pantalla por esto seria mas ruido que ayuda. Lo que si
 * hacia falta es el error: `actualizarAutoasignacion` lo descartaba en
 * silencio, y un RLS que negara el cambio dejaba el checkbox marcado como si
 * hubiera funcionado.
 */
export function ToggleAutoasignacion({
  permitido,
  cambiar,
}: {
  permitido: boolean;
  cambiar: (permitir: boolean) => Promise<FormState>;
}) {
  const [pending, startTransition] = useTransition();
  const { error: avisarError } = useNotificaciones();

  return (
    <label className="flex items-start gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <input
        type="checkbox"
        checked={permitido}
        disabled={pending}
        onChange={(e) =>
          startTransition(async () => {
            const r = await cambiar(e.target.checked);
            if (r.error) avisarError(r.error);
          })
        }
        className="mt-0.5 h-4 w-4 shrink-0 accent-lime-400 disabled:opacity-60"
      />
      <span className="text-sm">
        <span className="font-medium">
          Los jueces pueden tomar su propio carril
        </span>
        <span className="block text-neutral-500">
          Prendido: entran a Juzgar y eligen un carril libre ellos mismos.
          Apagado: solo la organización asigna carriles, desde Heats.
        </span>
      </span>
    </label>
  );
}
