"use client";

import { useActionState, useState } from "react";
import { editarParte, editarPrueba, type FormState } from "../actions";
import { Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { Selector } from "@/shared/components/Selector";
import { Modal, BotonesDeModal, useCerrarAlGuardar } from "@/shared/components/Modal";
import type { WorkoutPartRow, WorkoutRow } from "@/lib/supabase/types";

const inicial: FormState = { error: null };

const ESQUEMAS = [
  { value: "libre", label: "For Time (sin tope)" },
  { value: "cap", label: "For Time con cap" },
  { value: "ventana", label: "AMRAP (ventana fija)" },
  { value: "intervalos", label: "Intervalos (EMOM, Tabata)" },
  { value: "sin_reloj", label: "Carga máxima (sin reloj)" },
];

const UNIDADES = [
  { value: "tiempo", label: "Tiempo" },
  { value: "reps", label: "Repeticiones" },
  { value: "rondas", label: "Rondas" },
  { value: "rondas_reps", label: "Rondas + reps" },
  { value: "carga", label: "Carga" },
  { value: "distancia", label: "Distancia" },
  { value: "calorias", label: "Calorías" },
  { value: "puntos", label: "Puntos" },
];

const EQUIPO = [
  { value: "individual", label: "Individual" },
  { value: "sincronizado", label: "Sincronizado" },
  { value: "alternado", label: "Alternado" },
  { value: "relevo", label: "Relevo" },
  { value: "reparto_libre", label: "Reparto libre" },
];

/** Milisegundos a los minutos que se muestran en el formulario. */
const aMinutos = (ms: number | null) => (ms === null ? "" : String(ms / 60_000));

/**
 * El nombre y la descripción de la prueba.
 *
 * `workouts.description` existía y no la escribía nadie: se podía leer en la
 * ficha pública y no había forma de cargarla.
 */
export function EditarPrueba({
  eventId,
  workout,
}: {
  eventId: string;
  workout: WorkoutRow;
}) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(editarPrueba, inicial);
  useCerrarAlGuardar(pending, state.error, () => setAbierto(false));

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-xl border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-600"
      >
        Editar prueba
      </button>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Editar prueba">
        <form
          key={abierto ? "abierto" : "cerrado"}
          id="editar-prueba"
          action={formAction}
          className="flex flex-col gap-4 text-left"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="workoutId" value={workout.id} />

          <Field label="Nombre" name="name" defaultValue={workout.name} required />
          <Field
            label="Descripción"
            name="description"
            defaultValue={workout.description ?? ""}
            placeholder="Se muestra en la ficha pública cuando publicas la prueba"
          />
          <Field
            label="Etapa"
            name="stage"
            type="number"
            defaultValue={String(workout.stage)}
            ayuda="1 = todos compiten. 2 o más = solo quien avanzó en el corte de la etapa anterior (se confirma en Puntuación)."
          />
        </form>

        <BotonesDeModal
          cancelar={() => setAbierto(false)}
          guardando={pending}
          error={state.error}
          guardarId="editar-prueba"
          mensajeDeCarga="Guardando la prueba…"
        />
      </Modal>
    </>
  );
}

/**
 * Cómo se mide una parte: esquema, unidad, dirección y sus tiempos.
 *
 * Antes esto solo se podía elegir AL CREAR: corregir un cap de 10 a 12 minutos
 * obligaba a borrar la prueba entera con sus bloques y sus movimientos.
 *
 * Los campos de tiempo se muestran los tres siempre y no según el esquema: cuál
 * hace falta depende de lo que el organizador esté por elegir en el selector de
 * arriba, y esconderlos obligaría a volver a abrir el modal después de cambiar
 * el esquema. La base rechaza las combinaciones imposibles igual, y la acción
 * las traduce a un mensaje que se lee.
 */
export function EditarParte({
  eventId,
  part,
  titulo,
  otrasPartes,
}: {
  eventId: string;
  part: WorkoutPartRow;
  titulo: string;
  /** Las demas partes del evento, para elegir de donde sale un desempate ajeno. */
  otrasPartes: Array<{ id: string; nombre: string }>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(editarParte, inicial);
  useCerrarAlGuardar(pending, state.error, () => setAbierto(false));

  // "" | "propia" | "otra". No distingue 'hito' de 'manual' a proposito: esa
  // diferencia es COMO llega el valor, no de DONDE sale, y la accion la
  // deriva sola del modo de captura de la parte.
  const [desempate, setDesempate] = useState<"" | "propia" | "otra">(
    part.tiebreak_source === null ? "" : part.tiebreak_source === "otra_prueba" ? "otra" : "propia",
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg px-2 py-1 text-sm text-lime-400 transition-colors hover:bg-neutral-900"
      >
        Editar
      </button>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo={titulo}>
        <form
          key={abierto ? "abierto" : "cerrado"}
          id={`editar-parte-${part.id}`}
          action={formAction}
          className="flex flex-col gap-4 text-left"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="partId" value={part.id} />

          <Select
            label="Cómo se mide"
            name="timeScheme"
            defaultValue={part.time_scheme}
            options={ESQUEMAS}
          />

          <FieldRow>
            <Select
              label="Unidad del resultado"
              name="scoreUnit"
              defaultValue={part.score_unit}
              options={UNIDADES}
            />
            <Select
              label="Gana"
              name="scoreDir"
              defaultValue={part.score_dir}
              options={[
                { value: "menor_gana", label: "El menor" },
                { value: "mayor_gana", label: "El mayor" },
              ]}
            />
          </FieldRow>

          <FieldRow>
            <Field
              label="Cap (min)"
              name="capMinutos"
              type="number"
              defaultValue={aMinutos(part.time_cap_ms)}
              placeholder="solo For Time con cap"
            />
            <Field
              label="Ventana (min)"
              name="ventanaMinutos"
              type="number"
              defaultValue={aMinutos(part.window_ms)}
              placeholder="solo AMRAP"
            />
          </FieldRow>

          <FieldRow>
            {/* El peso de la prueba. Antes esto obligaba a crear una TABLA de
                puntos entera para decir "esta vale el doble"; un
                multiplicador dice lo mismo y no se puede desincronizar de la
                curva de la categoria. */}
            <Field
              label="Cuánto vale ganarla"
              name="maxPoints"
              type="number"
              defaultValue={Number(part.max_points) === 100 ? "" : String(part.max_points)}
              placeholder="100"
              ayuda="Puntos del 1.º. Vacío = 100, como el resto."
            />
            <Field
              label="Intervalo (seg)"
              name="intervaloSegundos"
              type="number"
              defaultValue={part.interval_ms === null ? "" : String(part.interval_ms / 1000)}
              placeholder="solo intervalos"
            />
          </FieldRow>

          <FieldRow>
            <Select
              label="Cómo trabaja el equipo"
              name="teamMode"
              defaultValue={part.team_mode}
              options={EQUIPO}
            />
          </FieldRow>

          <div className="border-t border-neutral-800 pt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Desempate</span>
              <Selector
                name="tiebreak"
                value={desempate}
                onChange={(e) => setDesempate(e.target.value as "" | "propia" | "otra")}
                className="w-full py-3"
              >
                <option value="">Ninguno</option>
                <option value="propia">El de esta prueba</option>
                <option value="otra">El de otra prueba</option>
              </Selector>
            </label>

            {desempate && (
              <FieldRow>
                <Select
                  label="Se mide en"
                  name="tiebreakUnit"
                  defaultValue={part.tiebreak_unit ?? "tiempo"}
                  options={UNIDADES}
                />
                <Select
                  label="Gana"
                  name="tiebreakDir"
                  defaultValue={part.tiebreak_dir ?? "menor_gana"}
                  options={[
                    { value: "menor_gana", label: "El menor" },
                    { value: "mayor_gana", label: "El mayor" },
                  ]}
                />
              </FieldRow>
            )}

            {desempate === "otra" && (
              <Select
                label="Prueba de origen"
                name="tiebreakPartId"
                defaultValue={part.tiebreak_part_id ?? ""}
                options={[
                  { value: "", label: "Elige una prueba…" },
                  ...otrasPartes.map((p) => ({ value: p.id, label: p.nombre })),
                ]}
              />
            )}

            <p className="mt-2 text-xs text-neutral-500">
              {desempate === "otra"
                ? "Si un equipo no corrió esa prueba, queda sin desempate: no rankea peor, solo no tiene con qué separarse de otro empate."
                : "El valor sale del movimiento marcado como desempate en esta misma prueba, o de lo que cargue el staff a mano."}
            </p>
          </div>
        </form>

        <BotonesDeModal
          cancelar={() => setAbierto(false)}
          guardando={pending}
          error={state.error}
          guardarId={`editar-parte-${part.id}`}
          mensajeDeCarga="Guardando la parte…"
        />
      </Modal>
    </>
  );
}
