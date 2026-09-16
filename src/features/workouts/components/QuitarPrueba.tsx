"use client";

import { useState } from "react";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { Boton, claseDeBoton } from "@/shared/components/Boton";
import { BotonQuitar } from "@/shared/components/BotonQuitar";
import { Modal } from "@/shared/components/Modal";
import type { FormState } from "@/features/workouts/actions";

type AccionEliminar = (
  eventId: string,
  workoutId: string,
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

/**
 * Quitar una prueba, con confirmación.
 *
 * ANTES DISPARABA LA ACCIÓN DIRECTO AL CLICK. Ya usaba el ícono "✕" en vez de
 * la palabra "Eliminar" —eso estaba bien—, pero le faltaba el segundo paso
 * que sí tienen "Quitar heat" (PantallaDeHeats.tsx), "Quitar atleta/equipo"
 * (GrillaDeAtletas.tsx) y "Eliminar categoría"/"Eliminar penalización": borrar
 * una prueba se lleva sus bloques, movimientos y specs por categoría, y un
 * toque desviado no puede borrar todo eso sin avisar.
 */
export function QuitarPrueba({
  eventId,
  workoutId,
  label,
  eliminar,
}: {
  eventId: string;
  workoutId: string;
  label: string;
  eliminar: AccionEliminar;
}) {
  const [confirmar, setConfirmar] = useState(false);

  return (
    <>
      <BotonQuitar onClick={() => setConfirmar(true)} title="Quitar prueba" />

      <Modal
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="Quitar prueba"
        ancho="max-w-sm"
      >
        <div className="text-left">
          <p className="text-sm text-neutral-300">
            ¿Quitar <span className="font-medium">{label}</span>? Se borra junto con sus bloques,
            movimientos y ajustes por categoría. Esta acción no se puede deshacer.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton variante="secondary" compacto onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
            <FormularioDeEstado
              accion={eliminar.bind(null, eventId, workoutId)}
              estadoInicial={{ error: null }}
              etiqueta="Quitar"
              mensajeDeCarga="Quitando la prueba…"
              className={claseDeBoton({ variante: "destructive", compacto: true })}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
