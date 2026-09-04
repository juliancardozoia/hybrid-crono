"use client";

import { useActionState } from "react";
import { guardarMonedaDelEvento, type FormState } from "../actions";
import { MONEDAS } from "../lib/monedas";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { Selector } from "@/shared/components/Selector";

/**
 * La moneda de la competencia.
 *
 * UNA SOLA, Y GOBIERNA TODO. Estaba por categoria, lo que solo tendria sentido
 * si alguien cobrara Elite en dolares y Amateur en pesos. Nadie hace eso: se
 * cobra en la moneda del pais donde se corre. Lo que si pasaba era el error —
 * seis categorias, seis desplegables, y uno quedaba en COP cuando los otros
 * cinco decian CLP.
 *
 * Y la pasarela es una sola por organizador: no se puede tener una cobrando en
 * dolares y otra en pesos para la misma competencia. Preguntarla por categoria
 * prometia una flexibilidad que no existe.
 *
 * Cambiarla BAJA a todas las categorias, por trigger. Si no, cambiarla aqui
 * dejaria los precios viejos etiquetados en la moneda nueva.
 */

export function MonedaDelEvento({
  eventId,
  actual,
}: {
  eventId: string;
  actual: string;
}) {
  const [state, formAction] = useActionState(guardarMonedaDelEvento, {
    error: null,
  } as FormState);

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4"
    >
      <input type="hidden" name="eventId" value={eventId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Moneda de la competencia</span>
        <Selector name="currency" defaultValue={actual} className="w-64 py-2.5 text-sm">
          {MONEDAS.map((m) => (
            <option key={m.codigo} value={m.codigo}>
              {m.codigo} — {m.nombre}
            </option>
          ))}
        </Selector>
      </label>

      <BotonDeEnvio
        pendienteTexto="Guardando…"
        mensajeDeCarga="Guardando la moneda…"
        className="rounded-xl border border-neutral-700 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-neutral-900 disabled:opacity-60"
      >
        Guardar
      </BotonDeEnvio>

      <p className="w-full text-xs text-neutral-600">
        Aplica a todos los medios de cobro y a todas las categorías.
      </p>

      {state.error && (
        <p className="w-full rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
