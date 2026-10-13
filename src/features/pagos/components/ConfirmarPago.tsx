"use client";

import { useState, useTransition } from "react";
import { confirmarPagoDeInscripcion } from "../actions";
import { Boton } from "@/shared/components/Boton";
import { useCargaMientras } from "@/shared/components/Carga";
import type { IntentoDePago } from "../queries";

/**
 * La organizacion marca un pago como recibido.
 *
 * Haya orden o no, pasa por `confirmar_pago_de_inscripcion`: crea la orden si
 * el atleta nunca llego a la pantalla de pago y deja el intento registrado con
 * su referencia. Cuando un atleta dice "yo pagué", hay que poder mostrar
 * exactamente que se registro, cuando y quien lo confirmo.
 */
export function ConfirmarPago({
  registrationId,
  eventId,
  intentos = [],
}: {
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
        <input
          value={referencia}
          onChange={(e) => setReferencia(e.target.value)}
          placeholder="Referencia de la transferencia"
          className="rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400"
        />
        <Boton
          variante="secondary"
          compacto
          cargando={pendiente}
          textoCargando="Confirmando…"
          onClick={() =>
            startTransition(async () => {
              const r = await confirmarPagoDeInscripcion(registrationId, eventId, referencia);
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
