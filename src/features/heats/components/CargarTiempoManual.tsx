"use client";

import { useActionState, useState } from "react";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { MensajeDeError } from "@/shared/components/MensajeDeError";

export interface SegmentoDeCircuito {
  id: string;
  name: string;
  orderIndex: number;
}

interface FormState {
  error: string | null;
}

/**
 * Carga manual del tiempo de UN carril, para el organizador que no
 * cronometró en vivo con el celular del juez — o que solo tiene el tiempo
 * final de una planilla de papel.
 *
 * NO REEMPLAZA al cronómetro en vivo: es un camino adicional, y por eso el
 * botón que la abre solo aparece cuando el carril todavía no tiene ningún
 * marcaje (ver `lane.puedeCargarManual` en TorreDeHeats.tsx) — mezclar los
 * dos caminos para el mismo carril produciría splits sin sentido.
 *
 * Dos modos, igual que le pide el organizador: "tengo los tiempos por
 * estación" (mejor, conserva los parciales) o "solo tengo el total" (cuando
 * no hay nada más). El toggle no aparece si el circuito no tiene segmentos
 * cargados — ahí solo existe el modo total.
 */
export function CargarTiempoManual({
  eventId,
  laneId,
  nombreCarril,
  segmentos,
  accion,
}: {
  eventId: string;
  laneId: string;
  nombreCarril: string;
  /** Los segmentos del circuito de la categoría de este carril, en orden. */
  segmentos: SegmentoDeCircuito[];
  accion: (
    eventId: string,
    laneId: string,
    prev: FormState,
    formData: FormData,
  ) => Promise<FormState>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<"total" | "estaciones">("total");
  const [state, formAction, pending] = useActionState(accion.bind(null, eventId, laneId), {
    error: null,
  });

  const ordenados = [...segmentos].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Cargar el tiempo a mano, sin cronometrar en vivo"
        className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-400 hover:border-lime-500/40 hover:text-lime-300"
      >
        Cargar tiempo
      </button>

      <Modal
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Cargar tiempo — ${nombreCarril}`}
        ancho="max-w-md"
      >
        {/* `key` remonta el formulario cada vez que se abre — mismo patrón que
            el resto de los modales de alta. */}
        <form
          key={abierto ? "abierto" : "cerrado"}
          id={`cargar-tiempo-${laneId}`}
          action={formAction}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="modo" value={modo} />

          {ordenados.length > 0 && (
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={modo === "total"}
                  onChange={() => setModo("total")}
                />
                Solo el tiempo total
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={modo === "estaciones"}
                  onChange={() => setModo("estaciones")}
                />
                Tengo los tiempos por estación
              </label>
            </div>
          )}

          {modo === "total" || ordenados.length === 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-400">Tiempo total (mm:ss)</span>
              <input
                type="text"
                name="total"
                required
                placeholder="45:12"
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 placeholder:text-neutral-600"
              />
            </label>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-neutral-500">
                Un tiempo por estación, en el orden en que se corren. La duración de cada una, no
                el acumulado.
              </p>
              {ordenados.map((segmento, i) => (
                <label key={segmento.id} className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">
                    {i + 1}. {segmento.name}
                  </span>
                  <input
                    type="text"
                    name={`estacion_${i}`}
                    required
                    placeholder="mm:ss"
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 placeholder:text-neutral-600"
                  />
                </label>
              ))}
            </div>
          )}

          {state.error && <MensajeDeError>{state.error}</MensajeDeError>}
        </form>

        <BotonesDeModal
          cancelar={() => setAbierto(false)}
          guardando={pending}
          error={state.error}
          guardarId={`cargar-tiempo-${laneId}`}
          etiqueta="Cargar tiempo"
          mensajeDeCarga="Cargando el tiempo…"
        />
      </Modal>
    </>
  );
}
