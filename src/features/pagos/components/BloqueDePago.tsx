"use client";

import { useState, useTransition } from "react";
import { armarOrden, reportarPagoManual } from "../actions";
import { ADAPTADORES, montoLegible } from "../adapters";
import { paymentStatus } from "../lib/estado";
import { Boton } from "@/shared/components/Boton";
import { useCargaMientras } from "@/shared/components/Carga";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import { ZonaDeArchivo } from "@/shared/components/ZonaDeArchivo";
import type { IntentoDePago, MedioDePago } from "../queries";
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
  intentos,
}: {
  registrationId: string;
  orden: OrderRow | null;
  medios: MedioDePago[];
  intentos: IntentoDePago[];
}) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [mostrarCupon, setMostrarCupon] = useState(false);
  useCargaMientras(pendiente, "Preparando el pago…");

  function aplicar(valor: string) {
    setError(null);
    startTransition(async () => {
      const r = await armarOrden(registrationId, valor);
      setError(r.error);
      if (!r.error) {
        setCodigo("");
        setMostrarCupon(false);
      }
    });
  }

  // Sin código, `upsert_order` recalcula sin descuento -- es lo mismo
  // mecanismo que "aplicar", solo que con el campo vacío.
  function quitarCupon() {
    aplicar("");
  }

  // Todavía no hay orden: la primera visita la crea.
  if (!orden) {
    return (
      <section className="flex flex-col gap-3 border-t border-neutral-800 pt-6">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase">
          Pago
        </h2>
        <Boton
          className="self-start"
          onClick={() => aplicar("")}
          cargando={pendiente}
          textoCargando="Preparando…"
        >
          Ver cómo pagar
        </Boton>
        {error && (
          <MensajeDeError>{error}</MensajeDeError>
        )}
      </section>
    );
  }

  const estado = paymentStatus(orden);
  const pagada = estado === "pagado";
  const procesando = estado === "procesando";

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
          <p className="mt-1 flex items-center justify-end gap-2 text-right text-sm text-lime-400">
            <span>
              Descuento aplicado: −
              {montoLegible(orden.discount_cents, orden.currency)}
            </span>
            {!pagada && !procesando && (
              <button
                type="button"
                disabled={pendiente}
                onClick={quitarCupon}
                className="text-neutral-500 underline hover:text-neutral-300 disabled:opacity-60"
              >
                Quitar
              </button>
            )}
          </p>
        )}

        {pagada && (
          <p className="mt-3 rounded-xl bg-lime-400/10 p-3 text-sm text-lime-300">
            Pago recibido. Tu inscripción quedó confirmada.
          </p>
        )}

        {procesando && (
          <p className="mt-3 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-300">
            Estamos confirmando tu pago con la pasarela. No hace falta que
            hagas nada más — esto se actualiza solo.
          </p>
        )}
      </div>

      {!pagada && !procesando && (
        <>
          {intentos.length > 0 && (
            <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
              Reportaste un comprobante el{" "}
              {new Date(intentos[0].createdAt).toLocaleDateString()}. La
              organización lo está revisando — si necesitás corregirlo, podés
              subir otro más abajo.
            </p>
          )}

          {orden.discount_cents === 0 && (
            <>
              {mostrarCupon ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    autoFocus
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
              ) : (
                <button
                  type="button"
                  onClick={() => setMostrarCupon(true)}
                  className="self-start text-sm text-lime-400 hover:underline"
                >
                  ¿Tenés un código de descuento?
                </button>
              )}
            </>
          )}

          {error && (
            <MensajeDeError>{error}</MensajeDeError>
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
                          <ReportarComprobante
                            orderId={orden.id}
                            registrationId={registrationId}
                          />
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

/**
 * El atleta sube el comprobante y, opcionalmente, una referencia.
 *
 * Deja la orden EXACTAMENTE como estaba: nunca marca nada como pagado -- solo
 * deja evidencia para que el organizador la revise con `ConfirmarPago`.
 */
function ReportarComprobante({
  orderId,
  registrationId,
}: {
  orderId: string;
  registrationId: string;
}) {
  const [referencia, setReferencia] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [pendiente, startTransition] = useTransition();
  const { exito, error: avisarError } = useNotificaciones();
  useCargaMientras(pendiente, "Enviando el comprobante…");

  function reportar(ruta: string) {
    startTransition(async () => {
      const r = await reportarPagoManual(orderId, registrationId, ruta, referencia);
      if (r.error) {
        avisarError(r.error);
        return;
      }
      setEnviado(true);
      exito("Comprobante enviado. La organización lo va a revisar.");
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-neutral-800 pt-3">
      <p className="text-xs text-neutral-500">
        Cuando pagues, subí el comprobante acá. La organización lo revisa y
        confirma tu inscripción.
      </p>

      <input
        value={referencia}
        onChange={(e) => setReferencia(e.target.value)}
        placeholder="Referencia de la transferencia (opcional)"
        className="rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400"
      />

      <ZonaDeArchivo
        bucket="comprobantes"
        carpeta={registrationId}
        privado
        tipos={["image/jpeg", "image/png", "image/webp", "application/pdf"]}
        maximoMb={10}
        etiqueta={enviado ? "Subir otro comprobante" : "Subir comprobante de pago"}
        ayuda="JPG, PNG, WebP o PDF. Hasta 10 MB."
        onSubido={reportar}
      />
    </div>
  );
}
