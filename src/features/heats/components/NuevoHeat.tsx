"use client";

import { useActionState, useState } from "react";
import { createHeat, type FormState } from "../actions";
import { Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";

const inicial: FormState = { error: null };

/**
 * Alta de heat, en un MODAL — el mismo patrón que "Nueva categoría".
 *
 * SIN NOMBRE NI HORA DE LARGADA. Se preguntaban antes y no aportaban nada: el
 * nombre siempre terminaba siendo "Heat 1", "Heat 2"... y la hora real de
 * largada se pone después, en Cronograma. `createHeat` genera el nombre solo,
 * consecutivo POR CATEGORÍA.
 *
 * LA CATEGORÍA ES OBLIGATORIA Y SALE SOLO DE `divisions`. Antes había una
 * opción extra "Mixto — varias divisiones" que no era ninguna categoría real
 * —era `divisionId = null`— y se sacó: mezclar categorías en un heat es
 * justo lo que impide numerar "Heat 1, 2, 3" por categoría.
 */
export function NuevoHeat({
  eventId,
  divisiones,
}: {
  eventId: string;
  divisiones: Array<{ id: string; name: string }>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(createHeat, inicial);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        disabled={divisiones.length === 0}
        title={divisiones.length === 0 ? "Primero crea al menos una categoría" : undefined}
        className="w-fit rounded-xl border border-neutral-700 px-5 py-3 text-sm font-semibold transition-colors hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Nuevo heat
      </button>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Nuevo heat">
        {/* `key` remonta el formulario cada vez que se abre: sin esto, un
            intento a medias que se cancelo dejaba los campos con lo ultimo
            escrito la proxima vez que se abriera el modal. */}
        <form
          key={abierto ? "abierto" : "cerrado"}
          id="nuevo-heat"
          action={formAction}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="eventId" value={eventId} />

          <FieldRow>
            <Select
              label="Categoría"
              name="divisionId"
              required
              options={[
                { value: "", label: "Elige una categoría…" },
                ...divisiones.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
            <Field
              label="Carriles"
              name="laneCount"
              type="number"
              defaultValue={6}
              required
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
          guardarId="nuevo-heat"
          etiqueta="Crear heat"
          mensajeDeCarga="Creando el heat…"
        />
      </Modal>
    </>
  );
}
