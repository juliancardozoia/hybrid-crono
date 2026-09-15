"use client";

import { useState, useTransition } from "react";
import { confirmarPagoManual } from "../actions";
import { confirmarInscripcion } from "@/features/inscripciones/actions";
import { Boton } from "@/shared/components/Boton";
import { useCargaMientras } from "@/shared/components/Carga";
import type { IntentoDePago } from "../queries";

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
  intentos = [],
}: {
  orderId: string | null;
  registrationId: string;
  eventId: string;
  /** Lo que el atleta ya reportó, con su comprobante firmado — el más reciente primero. */
  intentos?: IntentoDePago[];
}) {
  const [referencia, setReferencia] = useState(intentos[0]?.referencia ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  useCargaMientras(pendiente, "Confirmando el pago…");

  return (
    <div className="flex flex-col gap-2">
      {intentos.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-neutral-400">
          {intentos.map((i) => (
            <li key={i.id}>
              Reportado el {new Date(i.createdAt).toLocaleString()}
              {i.receiptUrl && (
                <>
                  {" — "}
                  <a
                    href={i.receiptUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-lime-400 hover:underline"
                  >
                    Ver comprobante
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {orderId && (
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Referencia de la transferencia"
            className="rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400"
          />
        )}
        <Boton
          variante="secondary"
          compacto
          cargando={pendiente}
          textoCargando="Confirmando…"
          onClick={() =>
            startTransition(async () => {
              const r = orderId
                ? await confirmarPagoManual(orderId, eventId, referencia)
                : await confirmarInscripcion(registrationId, eventId);
              setError(r.error);
            })
          }
        >
          Marcar como pagada
        </Boton>
        <span className="text-xs text-neutral-600">
          Le asigna dorsal y la suma al padrón.
        </span>
      </div>
      {error && <span className="text-sm text-red-300">{error}</span>}
    </div>
  );
}
