"use client";

import { useTransition } from "react";
import {
  reordenarBloques,
  reordenarMovimientos,
  reordenarPruebas,
} from "../actions";
import { useNotificaciones } from "@/shared/components/Notificaciones";

/**
 * Sube o baja un elemento en su lista.
 *
 * Manda la lista ENTERA ya reordenada, no "moveme uno arriba": la función de
 * Postgres corre todos los índices fuera de rango y después los reasigna, que
 * es lo único que no choca contra `unique (padre, order_index)` a mitad de
 * camino. Una lista incompleta la rechaza entera.
 *
 * Es un componente de cliente porque los botones necesitan un handler, y la
 * página que los pinta es de servidor: no se le puede pasar una función.
 */
export function BotonesDeOrden({
  eventId,
  contenedorId,
  ids,
  actual,
  tipo,
}: {
  eventId: string;
  /** El evento, la parte o el bloque, según el tipo. */
  contenedorId: string;
  /** Todos los hermanos, en el orden actual. */
  ids: string[];
  actual: string;
  tipo: "prueba" | "bloque" | "movimiento";
}) {
  const [pendiente, startTransition] = useTransition();
  const { error: avisarError } = useNotificaciones();

  const i = ids.indexOf(actual);
  const primero = i <= 0;
  const ultimo = i === ids.length - 1;

  const mover = (delta: number) => {
    const siguiente = [...ids];
    const destino = i + delta;
    [siguiente[i], siguiente[destino]] = [siguiente[destino], siguiente[i]];

    startTransition(async () => {
      const r =
        tipo === "prueba"
          ? await reordenarPruebas(eventId, siguiente)
          : tipo === "bloque"
            ? await reordenarBloques(eventId, contenedorId, siguiente)
            : await reordenarMovimientos(eventId, contenedorId, siguiente);
      if (r.error) avisarError(r.error);
    });
  };

  // Con un solo elemento no hay nada que ordenar: dos flechas apagadas son
  // ruido en una lista de un item.
  if (ids.length < 2) return null;

  return (
    <span className="flex items-center">
      <button
        type="button"
        disabled={primero || pendiente}
        onClick={() => mover(-1)}
        className="px-1.5 text-neutral-600 transition-colors hover:text-neutral-300 disabled:opacity-30"
        title="Subir"
      >
        ▲
      </button>
      <button
        type="button"
        disabled={ultimo || pendiente}
        onClick={() => mover(1)}
        className="px-1.5 text-neutral-600 transition-colors hover:text-neutral-300 disabled:opacity-30"
        title="Bajar"
      >
        ▼
      </button>
    </span>
  );
}
