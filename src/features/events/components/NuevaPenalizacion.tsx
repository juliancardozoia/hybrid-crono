"use client";

import { useActionState, useState } from "react";
import { createPenaltyType, type FormState } from "../config/actions";
import { Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { BotonAbrirModal } from "@/shared/components/BotonAbrirModal";

const inicial: FormState = { error: null };

/** Alta de penalización, en un MODAL — mismo patrón que "Crear categoría". */
export function NuevaPenalizacion({ eventId }: { eventId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(createPenaltyType, inicial);

  return (
    <>
      <BotonAbrirModal onClick={() => setAbierto(true)}>Crear penalización</BotonAbrirModal>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Crear penalización">
        {/* `key` remonta el formulario cada vez que se abre: sin esto, un
            intento a medias que se cancelo dejaba los campos con lo ultimo
            escrito la proxima vez que se abriera el modal. */}
        <form
          key={abierto ? "abierto" : "cerrado"}
          id="nueva-penalizacion"
          action={formAction}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="eventId" value={eventId} />

          <FieldRow>
            <Field label="Código" name="code" required placeholder="ROM" />
            <Field
              label="Descripción"
              name="label"
              required
              placeholder="Rango de movimiento"
            />
          </FieldRow>
          <FieldRow>
            <Select
              label="Tipo"
              name="kind"
              required
              options={[
                { value: "", label: "Elige un tipo…" },
                { value: "time_add", label: "Suma tiempo" },
                { value: "no_rep", label: "Repetición inválida (no suma)" },
                { value: "dq", label: "Descalifica" },
              ]}
            />
            <Field
              label="Segundos (solo si suma tiempo)"
              name="seconds"
              type="number"
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
          guardarId="nueva-penalizacion"
          etiqueta="Crear penalización"
          mensajeDeCarga="Creando la penalización…"
        />
      </Modal>
    </>
  );
}
