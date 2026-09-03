"use client";

import { useState, useTransition } from "react";
import { armarOrden } from "../actions";
import { ADAPTADORES, montoLegible } from "../adapters";
import { useCargaMientras } from "@/shared/components/Carga";
import type { MedioDePago } from "../queries";
import type { OrderRow, PaymentProvider } from "@/lib/supabase/types";

/**
 * Lo que ve el atleta cuando su inscripcion quedo esperando pago.
 *
 * Muestra el total, deja probar un codigo de descuento y lista los medios que
 * el organizador configuro. Cada medio se describe con su propio adaptador, asi
 * que agregar una pasarela no toca esta pantalla.
 */
export function BloqueDePago({
  registrationId,
  orden,
  medios,
}: {
  registrationId: string;
  orden: OrderRow | null;
  medios: MedioDePago[];
}) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState<string | null>(null);
  useCargaMientras(pendiente, "Preparando el pago…");

  function aplicar(valor: string) {
    setError(null);
    startTransition(async () => {
      const r = await armarOrden(registrationId, valor);
      setError(r.error);
    });
  }

  // Todavía no hay orden: la primera visita la crea.
  if (!orden) {
    return (
      <section className="flex flex-col gap-3 border-t border-neutral-800 pt-6">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase">
          Pago
        </h2>
        <button
          type="button"
          disabled={pendiente}
          onClick={() => aplicar("")}
          className="self-start rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 hover:bg-lime-300 disabled:opacity-60"
        >
          {pendiente ? "Preparando…" : "Ver cómo pagar"}
        </button>
        {error && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </section>
    );
  }

  const pagada = orden.status === "pagada";

  return (
    <section className="flex flex-col gap-4 border-t border-neutral-800 pt-6">
      <h2 className="text-sm font-semibold text-neutral-400 uppercase">Pago</h2>

      <div className="rounded-2xl border border-neutral-800 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-neutral-400">Total</span>
          <span className="font-mono text-2xl font-bold">
            {montoLegible(orden.total_cents, orden.currency)}
          </span>
        </div>

        {orden.discount_cents > 0 && (
          <p className="mt-1 text-right text-sm text-lime-400">
            Descuento aplicado: −
            {montoLegible(orden.discount_cents, orden.currency)}
          </p>
        )}

        {pagada && (
          <p className="mt-3 rounded-xl bg-lime-400/10 p-3 text-sm text-lime-300">
            Pago recibido. Tu inscripción quedó confirmada.
          </p>
        )}
      </div>

      {!pagada && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              placeholder="Código de descuento"
              className="flex-1 rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400"
            />
            <button
              type="button"
              disabled={pendiente || !codigo}
              onClick={() => aplicar(codigo)}
              className="rounded-xl border border-neutral-700 px-5 py-3 text-sm hover:bg-neutral-900 disabled:opacity-60"
            >
              {pendiente ? "…" : "Aplicar"}
            </button>
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {medios.length === 0 ? (
            <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
              La organización todavía no configuró medios de pago. Escribiles
              para saber cómo abonar.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {medios.map((medio) => {
                const adaptador =
                  ADAPTADORES[medio.provider as PaymentProvider];
                if (!adaptador) return null;

                const info = adaptador.instrucciones({
                  publicConfig: medio.publicConfig,
                  totalCents: orden.total_cents,
                  currency: orden.currency,
                  orderId: orden.id,
                });
                const expandido = abierto === medio.id;

                return (
                  <li
                    key={medio.id}
                    className="rounded-2xl border border-neutral-800"
                  >
                    <button
                      type="button"
                      onClick={() => setAbierto(expandido ? null : medio.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <span className="font-medium">
                        {info.titulo}
                        {medio.label && (
                          <span className="ml-2 text-sm text-neutral-500">
                            {medio.label}
                          </span>
                        )}
                      </span>
                      <span className="text-neutral-600">
                        {expandido ? "−" : "+"}
                      </span>
                    </button>

                    {expandido && (
                      <div className="border-t border-neutral-800 px-4 py-3">
                        <ul className="flex flex-col gap-1 text-sm text-neutral-300">
                          {info.detalle.map((linea, i) => (
                            <li key={i}>{linea}</li>
                          ))}
                        </ul>
                        {info.requiereConfirmacionManual && (
                          <p className="mt-3 text-xs text-neutral-500">
                            Cuando pagues, la organización lo confirma y tu
                            inscripción queda lista.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
