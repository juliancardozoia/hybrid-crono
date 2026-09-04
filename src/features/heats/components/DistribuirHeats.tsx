"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { autoDistribuirHeats, type EstadoDistribucion } from "../actions";
import { Field } from "@/shared/components/SimpleForm";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { useNotificaciones } from "@/shared/components/Notificaciones";

const inicial: EstadoDistribucion = { error: null, resumen: null };

/**
 * Arma todos los heats de todas las categorías de una sola vez: numerados,
 * con la cantidad de carriles que se pida, y los jueces al azar entre los ya
 * cargados en el evento.
 *
 * ES PARA 80 ATLETAS O MÁS. Armar heat por heat y elegir juez por juez a
 * mano deja de ser razonable a partir de cierto tamaño, y elegir a mano quién
 * juzga a quién es justo el lugar donde alguien podría acomodar el
 * resultado — de ahí el sorteo.
 *
 * SE PUEDE CORRER MÁS DE UNA VEZ. Cada corrida recalcula: los heats que
 * todavía no largaron se rearman con el padrón actual (incluye atletas
 * nuevos desde la corrida anterior); los que ya largaron no se tocan.
 */
export function DistribuirHeats({ eventId }: { eventId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(autoDistribuirHeats, inicial);
  const { exito } = useNotificaciones();
  const resumenAvisado = useRef<string | null>(null);

  // El resumen ("N heats en M categorías...") se avisa como toast porque el
  // modal se cierra solo al terminar sin error (BotonesDeModal), y ahí
  // adentro ya no quedaría nadie para leerlo.
  useEffect(() => {
    if (state.resumen && state.resumen !== resumenAvisado.current) {
      exito(state.resumen);
      resumenAvisado.current = state.resumen;
    }
  }, [state.resumen, exito]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-fit rounded-xl bg-lime-400 px-5 py-3 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300"
      >
        Distribuir automáticamente
      </button>

      <Modal
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Distribución automática"
      >
        <form
          key={abierto ? "abierto" : "cerrado"}
          id="distribuir-heats"
          action={formAction}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="eventId" value={eventId} />

          <p className="text-sm text-neutral-400">
            Arma los heats de <strong className="text-neutral-200">todas las categorías</strong>{" "}
            con equipos confirmados, numerados desde 1, y reparte los jueces ya cargados al azar
            entre los carriles. Los heats que todavía no largaron se rearman desde cero; los que ya
            largaron no se tocan.
          </p>

          <Field
            label="Carriles por heat"
            name="lanesPorHeat"
            type="number"
            defaultValue={6}
            required
          />

          {state.error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {state.error}
            </p>
          )}
        </form>

        <BotonesDeModal
          cancelar={() => setAbierto(false)}
          guardando={pending}
          error={state.error}
          guardarId="distribuir-heats"
          etiqueta="Distribuir"
          mensajeDeCarga="Distribuyendo atletas y jueces…"
        />
      </Modal>
    </>
  );
}
