"use client";

import { useActionState, useTransition } from "react";
import { borrarCodigo, crearCodigo, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { Selector } from "@/shared/components/Selector";
import { useCarga } from "@/shared/components/Carga";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import type { DiscountCodeRow } from "@/lib/supabase/types";

/**
 * Codigos de descuento del evento.
 *
 * El uso se cuenta cuando el pago entra de verdad, no cuando alguien escribe el
 * codigo: contarlo antes deja cupones agotados por gente que nunca pago.
 */

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400";

function valorLegible(c: DiscountCodeRow): string {
  return c.kind === "porcentaje"
    ? `${c.value}%`
    : `${(c.value / 100).toLocaleString("es")}`;
}

export function CodigosDeDescuento({
  eventId,
  codigos,
  divisiones = [],
}: {
  eventId: string;
  codigos: DiscountCodeRow[];
  /** Para poder acotar un código a una categoría. Vacío = toda la competencia. */
  divisiones?: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useActionState(crearCodigo, {
    error: null,
  } as FormState);
  const [, startTransition] = useTransition();
  const { activar, desactivar } = useCarga();
  const { error: avisarError } = useNotificaciones();

  function quitarCodigo(id: string) {
    startTransition(async () => {
      activar("Quitando el código…");
      try {
        const r = await borrarCodigo(eventId, id);
        if (r.error) avisarError(r.error);
      } finally {
        desactivar();
      }
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-neutral-400 uppercase">
        Códigos de descuento
      </h3>

      {codigos.length > 0 && (
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {codigos.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <span className="font-mono font-medium">
                {c.code.toUpperCase()}
              </span>
              <span className="text-sm text-neutral-400">
                −{valorLegible(c)}
              </span>
              <span className="text-sm text-neutral-600">
                {c.used_count} usado{c.used_count === 1 ? "" : "s"}
                {c.max_uses !== null && ` de ${c.max_uses}`}
              </span>
              <button
                type="button"
                onClick={() => quitarCodigo(c.id)}
                className="ml-auto px-2 text-sm text-neutral-600 hover:text-red-400"
                title="Quitar código"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        action={formAction}
        className="rounded-2xl border border-neutral-800 p-4"
      >
        <input type="hidden" name="eventId" value={eventId} />

        {divisiones.length > 0 && (
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Aplica a</span>
            <Selector name="divisionId" defaultValue="" className="w-full py-2">
              {/* Vacío = toda la competencia. Es el caso más común —un
                  "early bird" para todos— y por eso va primero. */}
              <option value="">Toda la competencia</option>
              {divisiones.map((d) => (
                <option key={d.id} value={d.id}>
                  Solo {d.name}
                </option>
              ))}
            </Selector>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Código</span>
            <input
              name="code"
              required
              placeholder="EARLY20"
              className={campo}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Tipo</span>
            <Selector name="kind" defaultValue="porcentaje" className="w-full py-2">
              <option value="porcentaje">Porcentaje</option>
              <option value="monto">Monto fijo</option>
            </Selector>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Valor</span>
            <input
              name="valor"
              type="number"
              min="1"
              required
              className={campo}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Usos máximos</span>
            <input
              name="maxUses"
              type="number"
              min="1"
              placeholder="sin límite"
              className={campo}
            />
          </label>

          <BotonDeEnvio
            pendienteTexto="…"
            mensajeDeCarga="Creando el código…"
            className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60"
          >
            Crear código
          </BotonDeEnvio>
        </div>

        {state.error && (
          <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">
            {state.error}
          </p>
        )}
      </form>
    </section>
  );
}
