"use client";

import { useState } from "react";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { Boton, claseDeBoton } from "@/shared/components/Boton";
import { BotonQuitar } from "@/shared/components/BotonQuitar";
import { Modal } from "@/shared/components/Modal";
import type { FormState } from "@/features/events/config/actions";

type AccionEliminar = (
  eventId: string,
  penaltyId: string,
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

/**
 * Quitar un tipo de penalización, con confirmación.
 *
 * ANTES ERA LA PALABRA "Eliminar" DISPARANDO LA ACCIÓN DIRECTO AL CLICK —
 * la única pantalla de alta que no seguía ni el ícono ni la confirmación que
 * ya usan "Quitar atleta/equipo" (GrillaDeAtletas.tsx) y "Quitar heat"
 * (PantallaDeHeats.tsx). Mismo patrón acá: ícono "✕", y un segundo paso antes
 * de borrar.
 */
export function QuitarPenalizacion({
  eventId,
  penaltyId,
  label,
  eliminar,
}: {
  eventId: string;
  penaltyId: string;
  label: string;
  eliminar: AccionEliminar;
}) {
  const [confirmar, setConfirmar] = useState(false);

  return (
    <>
      <BotonQuitar onClick={() => setConfirmar(true)} title="Eliminar penalización" />

      <Modal
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="Eliminar penalización"
        ancho="max-w-sm"
      >
        <div className="text-left">
          <p className="text-sm text-neutral-300">
            ¿Eliminar <span className="font-medium">{label}</span>? El juez deja de verla en el
            menú de PENALIZAR. Esta acción no se puede deshacer.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton variante="secondary" compacto onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
            <FormularioDeEstado
              accion={eliminar.bind(null, eventId, penaltyId)}
              estadoInicial={{ error: null }}
              etiqueta="Eliminar"
              mensajeDeCarga="Eliminando la penalización…"
              className={claseDeBoton({ variante: "destructive", compacto: true })}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
