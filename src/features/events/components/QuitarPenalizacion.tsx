"use client";

import { useState } from "react";
import { BotonQuitar } from "@/shared/components/BotonQuitar";
import { ModalDeConfirmacion } from "@/shared/components/ModalDeConfirmacion";
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

      <ModalDeConfirmacion
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="Eliminar penalización"
        descripcion={
          <>
            ¿Eliminar <span className="font-medium">{label}</span>? El juez deja de verla en el
            menú de PENALIZAR. Esta acción no se puede deshacer.
          </>
        }
        accion={eliminar.bind(null, eventId, penaltyId)}
        estadoInicial={{ error: null }}
        etiquetaConfirmar="Eliminar"
        mensajeDeCarga="Eliminando la penalización…"
      />
    </>
  );
}
