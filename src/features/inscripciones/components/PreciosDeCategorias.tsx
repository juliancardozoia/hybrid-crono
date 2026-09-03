"use client";

import { useActionState } from "react";
import { guardarPreciosDeCategorias, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { DivisionRegistration } from "@/lib/supabase/types";

/**
 * El precio de cada categoria, en UN solo formulario.
 *
 * Tenia un formulario y un boton "Guardar" por categoria: con diez categorias
 * eran diez botones identicos, y nada distinguia cual ya se habia guardado.
 * Ahora es una lista de campos y un unico "Guardar precios" al final — la misma
 * idea que ya usa la lista de descuentos, una sola escritura para todo el lote.
 */

export function PreciosDeCategorias({
  eventId,
  moneda,
  divisiones,
  config,
}: {
  eventId: string;
  moneda: string;
  divisiones: Array<{ id: string; name: string }>;
  config: Map<string, DivisionRegistration>;
}) {
  const [state, formAction] = useActionState(guardarPreciosDeCategorias, {
    error: null,
  } as FormState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="eventId" value={eventId} />
      <input
        type="hidden"
        name="divisionIds"
        value={divisiones.map((d) => d.id).join(",")}
      />

      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {divisiones.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="min-w-40 flex-1 font-medium">{d.name}</span>
            <label className="flex items-center gap-2">
              <span className="text-sm text-neutral-500">{moneda}</span>
              <input
                name={`precio_${d.id}`}
                type="number"
                min="0"
                step="1"
                placeholder="0 = sin costo"
                defaultValue={
                  config.get(d.id)?.price_cents != null
                    ? config.get(d.id)!.price_cents! / 100
                    : ""
                }
                className="w-40 rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400"
              />
            </label>
          </li>
        ))}
      </ul>

      {state.error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <BotonDeEnvio
        pendienteTexto="Guardando…"
        mensajeDeCarga="Guardando los precios…"
        className="self-start rounded-xl border border-neutral-700 px-4 py-2.5 text-sm font-medium hover:bg-neutral-900 disabled:opacity-60"
      >
        Guardar precios
      </BotonDeEnvio>
    </form>
  );
}
