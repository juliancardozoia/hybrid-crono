"use client";

import { useActionState, useState } from "react";
import { createHeat, type FormState } from "../actions";
import { Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { BotonAbrirModal } from "@/shared/components/BotonAbrirModal";

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
 *
 * LA PRUEBA SE PREGUNTA SOLO SI HAY MÁS DE UNA. Una carrera híbrida tiene una
 * sola y el modal sigue teniendo exactamente dos campos, como antes; un
 * CrossFit con tres WODs suma el selector, porque ahí "¿cuál de las tres
 * corre este heat?" no la puede contestar nadie más que el organizador.
 */
export function NuevoHeat({
  eventId,
  divisiones,
  pruebas,
}: {
  eventId: string;
  divisiones: Array<{ id: string; name: string }>;
  pruebas: Array<{ id: string; name: string }>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(createHeat, inicial);

  return (
    <>
      <BotonAbrirModal
        onClick={() => setAbierto(true)}
        disabled={divisiones.length === 0}
        title={divisiones.length === 0 ? "Primero crea al menos una categoría" : undefined}
      >
        Crear heat
      </BotonAbrirModal>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Crear heat">
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

          {/* Con una sola prueba viaja oculta: preguntar algo que tiene una
              única respuesta posible es un campo de más en el camino. Con
              ninguna todavía, no se manda nada y la pone el trigger. */}
          {pruebas.length === 1 && (
            <input type="hidden" name="workoutId" value={pruebas[0].id} />
          )}

          {pruebas.length > 1 && (
            <Select
              label="Prueba"
              name="workoutId"
              required
              options={[
                { value: "", label: "Elige una prueba…" },
                ...pruebas.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          )}

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
