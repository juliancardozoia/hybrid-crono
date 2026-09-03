"use client";

import { useState } from "react";
import { ADAPTADORES, MEDIOS_OFRECIDOS } from "../adapters";
import { ConfigurarProveedor } from "./ConfigurarProveedor";
import { MonedaDelEvento } from "./MonedaDelEvento";
import type { PaymentProvider } from "@/lib/supabase/types";

export interface ProveedorConfigurado {
  provider: PaymentProvider;
  label: string | null;
  publicConfig: Record<string, string>;
  active: boolean;
}

/**
 * Como cobra esta competencia.
 *
 * SE MUESTRA UNO A LA VEZ, NO LOS CUATRO. Antes se pintaban los cuatro
 * formularios completos, uno debajo de otro: veinte campos de los que se llenan
 * cinco. Quien usa transferencia tenia que hacer scroll por tres pasarelas que
 * no va a tocar nunca, y ninguna de las cuatro se veia como "la elegida".
 *
 * Ahora arriba estan los medios como fichas —con su estado, activo o no— y
 * debajo el formulario del que se elija. Los ya configurados se marcan, asi que
 * la respuesta a "¿ya puedo cobrar?" esta antes de abrir nada.
 *
 * LA MONEDA VA PRIMERO Y ES UNA SOLA. Gobierna a todos los medios: no se puede
 * tener una pasarela cobrando en dolares y otra en pesos para la misma
 * competencia, y preguntarla por categoria —como estaba— prometia una
 * flexibilidad que la pasarela no tiene.
 */
export function MediosDeCobro({
  eventId,
  orgId,
  moneda,
  configurados,
}: {
  eventId: string;
  orgId: string;
  moneda: string;
  configurados: ProveedorConfigurado[];
}) {
  const porProveedor = new Map(configurados.map((c) => [c.provider, c]));
  const activos = configurados.filter((c) => c.active);

  // Se abre en el primero que ya este configurado: es el que se viene a tocar.
  const [abierto, setAbierto] = useState<PaymentProvider>(
    activos[0]?.provider ?? MEDIOS_OFRECIDOS[0],
  );

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold text-neutral-400 uppercase">Cómo se cobra</h3>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          El dinero va <span className="text-neutral-300">directo a tus cuentas</span>: la
          plataforma no lo custodia. Estas credenciales son de tu organización y valen para todas
          tus competencias.
        </p>
      </div>

      <MonedaDelEvento eventId={eventId} actual={moneda} />

      {activos.length === 0 && (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          Todavía no hay ningún medio de cobro activo. Sin uno, las categorías con precio no se
          pueden pagar y la inscripción queda esperando para siempre.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {MEDIOS_OFRECIDOS.map((provider) => {
          const actual = porProveedor.get(provider);
          const elegido = provider === abierto;

          return (
            <button
              key={provider}
              type="button"
              onClick={() => setAbierto(provider)}
              aria-pressed={elegido}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                elegido
                  ? "border-lime-400 bg-lime-400/10 text-lime-300"
                  : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
              }`}
            >
              {ADAPTADORES[provider].nombre}
              {/* El punto responde "¿ya puedo cobrar por acá?" sin abrir nada. */}
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  actual?.active ? "bg-lime-400" : "bg-neutral-700"
                }`}
                aria-label={actual?.active ? "activo" : "sin configurar"}
              />
            </button>
          );
        })}
      </div>

      {(() => {
        const actual = porProveedor.get(abierto);
        return (
          <ConfigurarProveedor
            // `key` fuerza a React a montar un formulario NUEVO al cambiar de
            // medio: sin ella reusa el anterior y los campos quedan con los
            // valores de la pasarela que se acaba de dejar.
            key={abierto}
            orgId={orgId}
            provider={abierto}
            actual={
              actual
                ? {
                    label: actual.label,
                    publicConfig: actual.publicConfig,
                    active: actual.active,
                    tieneSecreto: ADAPTADORES[abierto].requiereSecreto,
                  }
                : null
            }
          />
        );
      })()}

      <p className="text-xs text-neutral-600">
        Las claves secretas se guardan cifradas y no se pueden volver a leer, ni desde la app ni
        desde la base de datos. Si pierdes una, hay que cargarla de nuevo.
      </p>
    </section>
  );
}
