"use client";

import { useActionState, useState } from "react";
import {
  createDivision,
  type FormState,
} from "@/features/events/config/actions";
import { Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { BotonAbrirModal } from "@/shared/components/BotonAbrirModal";
import type { CourseTemplate, EventFormat } from "@/lib/supabase/types";

const inicial: FormState = { error: null };

/**
 * Alta de categoria, en un MODAL — no un formulario fijo al pie de la grilla.
 *
 * EL CIRCUITO YA NO ES OBLIGATORIO, y era lo ultimo que quedaba del modelo
 * viejo. Cuando la plataforma solo entendia de carreras hibridas, cada categoria
 * corria UN circuito y sin circuito no se podia crear ninguna. Una categoria de
 * CrossFit no corre un circuito: corre N pruebas, que se arman en el paso
 * siguiente. `divisions.course_template_id` se volvio nullable justo para esto.
 *
 * Por eso el selector de circuito aparece SOLO si el evento lo necesita:
 *
 *   carrera hibrida   se pide, porque el tiempo sale de cronometrar ese circuito
 *   crossfit          no se pregunta, y ni siquiera se menciona
 *   mixto             se ofrece, pero se puede dejar vacio
 *
 * Preguntar por un circuito en un CrossFit no es solo un campo de mas: hace
 * dudar de si la herramienta entendio que competencia se esta armando.
 *
 * SIN CAMPO "NIVEL". Lo que decia —RX, Scaled, Elite— ya esta en el nombre de la
 * categoria ("Elite Masculino", "Rx Femenino"), y tenerlo en dos lugares
 * garantiza que un dia digan cosas distintas. La columna sigue en la base para
 * no perder lo ya cargado, pero no se pide mas.
 *
 * UN SOLO Guardar/Cancelar, como el resto de los modales de esta pantalla — ver
 * `BotonesDeModal`. Se cierra solo al crear con exito — es `BotonesDeModal`
 * el que llama a `useCerrarAlGuardar`, no este componente.
 */
export function NuevaDivision({
  eventId,
  templates,
  formato = "carrera_hibrida",
  tablas = [],
}: {
  eventId: string;
  templates: CourseTemplate[];
  formato?: EventFormat;
  /** Tablas de puntuacion. Solo se ofrecen en CrossFit. */
  tablas?: Array<{ id: string; name: string }>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(createDivision, inicial);

  const esCrossfit = formato === "crossfit";
  const pideCircuito = !esCrossfit && templates.length > 0;

  return (
    <>
      <BotonAbrirModal onClick={() => setAbierto(true)}>Crear categoría</BotonAbrirModal>

      <Modal
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Crear categoría"
        ancho="max-w-2xl"
      >
        {/* `key` remonta el formulario cada vez que se abre: sin esto, un
            intento a medias que se cancelo dejaba los campos con lo ultimo
            escrito la proxima vez que se abriera el modal. */}
        <form
          key={abierto ? "abierto" : "cerrado"}
          id="nueva-categoria"
          action={formAction}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="eventId" value={eventId} />

          <Field
            label="Nombre"
            name="name"
            required
            placeholder="Elite Masculino"
          />

          <FieldRow>
            <Select
              label="Integrantes"
              name="teamSize"
              options={[
                { value: "1", label: "1 — individual" },
                { value: "2", label: "2 — parejas" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
              ]}
            />
            <Select
              label="Sexo"
              name="genderRule"
              options={[
                { value: "any", label: "Abierta" },
                { value: "male", label: "Masculino" },
                { value: "female", label: "Femenino" },
                { value: "mixed", label: "Mixta (uno de cada sexo)" },
              ]}
            />
          </FieldRow>

          <FieldRow>
            <Field label="Edad mínima (opcional)" name="ageMin" type="number" />
            <Field label="Edad máxima (opcional)" name="ageMax" type="number" />
          </FieldRow>

          <FieldRow>
            {/* Se pregunta AL CREAR y no solo al editar: es lo primero que decide
                un organizador sobre una categoría, y dejarlo para después obliga
                a volver a abrirla una por una. */}
            <Field
              label="Límite de registros"
              name="capacity"
              type="number"
              placeholder="Sin límite"
              ayuda="Vacío = ilimitado."
            />

            {esCrossfit ? (
              <Select
                label="Sistema de puntuación"
                name="scoringTableId"
                options={[
                  { value: "", label: "La del evento" },
                  ...tablas.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            ) : (
              // Una carrera se gana llegando antes: no hay tabla que elegir, y
              // ofrecerla sería inventar una decisión que no existe.
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Puntuación</span>
                <p className="rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm text-neutral-400">
                  Por tiempo, menor gana
                </p>
              </div>
            )}
          </FieldRow>

          {pideCircuito && (
            <Select
              label="Circuito"
              name="courseTemplateId"
              options={[
                { value: "", label: "Ninguno" },
                ...templates.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          )}

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
          guardarId="nueva-categoria"
          etiqueta="Crear categoría"
          mensajeDeCarga="Creando la categoría…"
        />
      </Modal>
    </>
  );
}
