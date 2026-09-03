"use client";

import { useState, useTransition } from "react";
import { confirmarPagoManual } from "../actions";
import { confirmarInscripcion } from "@/features/inscripciones/actions";
import { useCargaMientras } from "@/shared/components/Carga";

/**
 * La organizacion marca un pago como recibido.
 *
 * Si hay orden, pasa por `confirmar_pago_manual`, que deja el intento
 * registrado con su referencia: cuando un atleta dice "yo pagué", hay que poder
 * mostrar exactamente que se registro y cuando.
 *
 * Si no hay orden —una inscripcion vieja, o una categoria a la que le pusieron
 * precio despues— se confirma la inscripcion directo. No es lo ideal, pero es
 * mejor que dejar a alguien trabado.
 */
export function ConfirmarPago({
  orderId,
  registrationId,
  eventId,
}: {
  orderId: string | null;
  registrationId: string;
  eventId: string;
}) {
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  useCargaMientras(pendiente, "Confirmando el pago…");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {orderId && (
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Referencia de la transferencia"
            className="rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400"
          />
        )}
        <button
          type="button"
          disabled={pendiente}
          onClick={() =>
            startTransition(async () => {
              const r = orderId
                ? await confirmarPagoManual(orderId, eventId, referencia)
                : await confirmarInscripcion(registrationId, eventId);
              setError(r.error);
            })
          }
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60"
        >
          {pendiente ? "Confirmando…" : "Marcar como pagada"}
        </button>
        <span className="text-xs text-neutral-600">
          Le asigna dorsal y la suma al padrón.
        </span>
      </div>
      {error && <span className="text-sm text-red-300">{error}</span>}
    </div>
  );
}
