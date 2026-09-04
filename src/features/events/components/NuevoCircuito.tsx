"use client";

import { useActionState, useState } from "react";
import { createCourseTemplate, type FormState } from "../config/actions";
import { Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { BotonAbrirModal } from "@/shared/components/BotonAbrirModal";

const inicial: FormState = { error: null };

/**
 * Alta de circuito, en un MODAL — mismo patrón que "Crear categoría".
 *
 * Reemplaza el formulario fijo al pie de la pantalla de Circuito: con dos o
 * tres circuitos ya cargados, ese formulario quedaba lejos, después de todos
 * los segmentos de cada uno.
 */
export function NuevoCircuito({ eventId }: { eventId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(createCourseTemplate, inicial);

  return (
    <>
      <BotonAbrirModal onClick={() => setAbierto(true)}>Crear circuito</BotonAbrirModal>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Crear circuito">
        {/* `key` remonta el formulario cada vez que se abre: sin esto, un
            intento a medias que se cancelo dejaba los campos con lo ultimo
            escrito la proxima vez que se abriera el modal. */}
        <form
          key={abierto ? "abierto" : "cerrado"}
          id="nuevo-circuito"
          action={formAction}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="eventId" value={eventId} />

          <FieldRow>
            <Field label="Nombre" name="name" required placeholder="Hyrox Estándar" />
            <Select
              label="Contenido"
              name="preset"
              options={[
                { value: "hyrox", label: "Preset Hyrox (16 segmentos)" },
                { value: "vacio", label: "Vacío" },
              ]}
            />
          </FieldRow>

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
          guardarId="nuevo-circuito"
          etiqueta="Crear circuito"
          mensajeDeCarga="Creando el circuito…"
        />
      </Modal>
    </>
  );
}
