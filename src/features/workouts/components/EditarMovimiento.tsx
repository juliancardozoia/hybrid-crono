"use client";

import { useActionState, useState } from "react";
import { editarBloque, editarMovimiento, type FormState } from "../actions";
import { Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { Modal, BotonesDeModal, useCerrarAlGuardar } from "@/shared/components/Modal";
import { desdeKilos } from "@/shared/unidades/carga";
import { estiloDelPaso } from "@/shared/timing/wod";
import type { BlockKind, PartBlockRow, PartMovementRow, TimeScheme } from "@/lib/supabase/types";

const inicial: FormState = { error: null };

const UNIDADES = [
  { value: "reps", label: "Repeticiones" },
  { value: "metros", label: "Metros" },
  { value: "calorias", label: "Calorías" },
  { value: "segundos", label: "Segundos" },
  { value: "kg", label: "Kilos" },
];

/** Cómo se ve cada estilo en la pantalla del juez. */
const ESTILOS: Record<string, string> = {
  tap: "toca cada rep",
  hecho: "un toque al terminar",
  numero: "escribe la cantidad",
};

/**
 * Edita un bloque, mostrando solo los campos que el TIPO elegido usa.
 *
 * Mismo criterio que `NuevoBloque`: un Descanso solo tiene Duracion (su largo);
 * Rondas, Descanso(seg) y Cap no significan nada para el y ya no se muestran.
 * Duracion/Descanso en un bloque que NO es Descanso son "solo intervalos" -asi
 * decian sus placeholders- asi que se piden solo si la prueba es EMOM/Tabata.
 *
 * "Cap de este bloque (min)" se ofrece para CUALQUIER bloque que no sea
 * Descanso: es justo lo que hace falta en un For Time con un descanso
 * obligatorio en el medio (trabajo con cap -> descanso -> trabajo). No se
 * oculta segun la posicion del bloque -aunque hoy sea el ultimo, reordenar o
 * agregar otro despues le puede devolver efecto, y esconderlo ahi invitaba a
 * pensar que dejo de poder cargarse-.
 *
 * LA EXCEPCION ES `sin_reloj` (carga maxima): ahi ni el cap ni las Rondas se
 * llegan a evaluar nunca -el esquema se cierra solo al agotar los intentos de
 * levantamiento, sin pasar por `stepIndex` ni por segmentos (ver `wod.ts`)-,
 * asi que a diferencia del resto de los esquemas no hay ninguna estructura de
 * bloques que le devuelva efecto. Sin la excepcion de arriba (reordenar puede
 * reactivarlo), esta si se puede esconder siempre.
 */
export function EditarBloque({
  eventId,
  bloque,
  timeScheme,
}: {
  eventId: string;
  bloque: PartBlockRow;
  timeScheme: TimeScheme;
}) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(editarBloque, inicial);
  useCerrarAlGuardar(pending, state.error, () => setAbierto(false));

  const [kind, setKind] = useState<BlockKind>(bloque.kind);
  const esDescanso = kind === "descanso";
  const esIntervalos = timeScheme === "intervalos";
  const esCargaMaxima = timeScheme === "sin_reloj";

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg px-2 py-1 text-xs text-lime-400 transition-colors hover:bg-neutral-900"
      >
        Editar bloque
      </button>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo="Editar bloque">
        <form
          key={abierto ? "abierto" : "cerrado"}
          id={`editar-bloque-${bloque.id}`}
          action={formAction}
          className="flex flex-col gap-4 text-left"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="blockId" value={bloque.id} />

          <FieldRow>
            <Select
              label="Tipo"
              name="kind"
              defaultValue={bloque.kind}
              onChange={(e) => setKind(e.target.value as BlockKind)}
              options={[
                { value: "trabajo", label: "Trabajo" },
                { value: "buy_in", label: "Buy-in" },
                { value: "cash_out", label: "Cash-out" },
                { value: "descanso", label: "Descanso" },
              ]}
            />
            {!esDescanso && !esCargaMaxima && (
              <Field
                label="Rondas"
                name="repeticiones"
                type="number"
                defaultValue={String(bloque.repeticiones)}
              />
            )}
          </FieldRow>

          <Field
            label="Nombre del bloque"
            name="label"
            defaultValue={bloque.label ?? ""}
            placeholder="Opcional: “Parte pesada”, “Buy-in”…"
          />

          {esDescanso ? (
            <Field
              label="Duración (seg)"
              name="duracionSegundos"
              type="number"
              defaultValue={bloque.duracion_ms === null ? "" : String(bloque.duracion_ms / 1000)}
              placeholder="Cuánto dura el descanso"
            />
          ) : (
            esIntervalos && (
              <FieldRow>
                <Field
                  label="Duración (seg)"
                  name="duracionSegundos"
                  type="number"
                  defaultValue={bloque.duracion_ms === null ? "" : String(bloque.duracion_ms / 1000)}
                />
                <Field
                  label="Descanso (seg)"
                  name="descansoSegundos"
                  type="number"
                  defaultValue={bloque.descanso_ms === null ? "" : String(bloque.descanso_ms / 1000)}
                />
              </FieldRow>
            )
          )}

          {!esDescanso && !esCargaMaxima && (
            <Field
              label="Cap de este bloque (min)"
              name="capMinutos"
              type="number"
              defaultValue={bloque.cap_ms === null ? "" : String(bloque.cap_ms / 60_000)}
              placeholder="Vacío = sin tope propio"
              ayuda="Se mide desde que ARRANCA este bloque, no desde la largada del heat. Solo tiene efecto si la prueba tiene algún bloque de Descanso: si no lo tiene, se ignora."
            />
          )}
        </form>

        <BotonesDeModal
          cancelar={() => setAbierto(false)}
          guardando={pending}
          error={state.error}
          guardarId={`editar-bloque-${bloque.id}`}
          mensajeDeCarga="Guardando el bloque…"
        />
      </Modal>
    </>
  );
}

/**
 * Un movimiento del WOD: objetivo, peso y CÓMO lo registra el juez.
 *
 * EL ESTILO DE CAPTURA ESTÁ ACÁ Y NO EN EL ALTA. Agregar un movimiento tiene
 * que seguir siendo tres campos; el estilo es un refinamiento que casi nunca se
 * toca, porque el derivado acierta solo.
 *
 * El default se llama "Automático" y MUESTRA lo que va a hacer entre
 * paréntesis. Sin eso, el organizador no tiene forma de saber qué eligió por él
 * y la única manera de enterarse sería abrir la app del juez.
 */
export function EditarMovimiento({
  eventId,
  movimiento,
  nombre,
  esCargaMaxima = false,
}: {
  eventId: string;
  movimiento: PartMovementRow;
  nombre: string;
  /** Solo la prueba de "Carga máxima" usa el tope de intentos. */
  esCargaMaxima?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction, pending] = useActionState(editarMovimiento, inicial);
  useCerrarAlGuardar(pending, state.error, () => setAbierto(false));

  // El derivado que se muestra al lado de "Automático". Se calcula con el
  // objetivo de la PRIMERA ronda: es el que el organizador tiene en la cabeza
  // cuando mira la lista, y en una escalera el resto solo puede ser más fácil.
  const derivado = estiloDelPaso(
    {
      id: movimiento.id,
      orderIndex: movimiento.order_index,
      name: nombre,
      unit: movimiento.unit,
      targetPerRound: movimiento.target_per_round,
      loadKg: movimiento.load_kg,
      loadUnit: movimiento.load_unit,
      maxReps: movimiento.max_reps,
      isTiebreak: movimiento.es_tiebreak,
      captureStyle: null,
      maxAttempts: movimiento.max_attempts,
    },
    movimiento.max_reps ? 0 : (movimiento.target_per_round[0] ?? 0),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-lg px-2 py-0.5 text-xs text-lime-400 transition-colors hover:bg-neutral-900"
      >
        Editar
      </button>

      <Modal abierto={abierto} alCerrar={() => setAbierto(false)} titulo={nombre}>
        <form
          key={abierto ? "abierto" : "cerrado"}
          id={`editar-mov-${movimiento.id}`}
          action={formAction}
          className="flex flex-col gap-4 text-left"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="movimientoId" value={movimiento.id} />

          <FieldRow>
            <Field
              label="Objetivo"
              name="objetivo"
              defaultValue={movimiento.target_per_round.join("-")}
              placeholder="21-15-9 o 50"
              ayuda="Un valor por ronda, o uno solo para todas."
            />
            <Select
              label="Unidad"
              name="unit"
              defaultValue={movimiento.unit}
              options={UNIDADES}
            />
          </FieldRow>

          <FieldRow>
            <Field
              label="Peso"
              name="load"
              defaultValue={
                movimiento.load_kg === null
                  ? ""
                  : String(desdeKilos(movimiento.load_kg, movimiento.load_unit))
              }
              placeholder="Sin peso"
            />
            <Select
              label="Unidad del peso"
              name="loadUnit"
              defaultValue={movimiento.load_unit}
              options={[
                { value: "kg", label: "kg" },
                { value: "lb", label: "lb" },
              ]}
            />
          </FieldRow>

          <Select
            label="Cómo lo registra el juez"
            name="captureStyle"
            defaultValue={movimiento.capture_style ?? ""}
            options={[
              { value: "", label: `Automático (${ESTILOS[derivado]})` },
              { value: "tap", label: "Toca cada repetición" },
              { value: "hecho", label: "Un toque al terminar" },
              { value: "numero", label: "Escribe la cantidad" },
            ]}
          />
          <p className="-mt-2 text-xs text-neutral-500">
            Automático pide un solo toque al terminar. Lo que no son repeticiones se
            escribe siempre, y &ldquo;las que pueda&rdquo; siempre se tapean.
          </p>

          {/* Solo "Carga máxima" tiene intentos que agotar: en cualquier otro
              esquema el carril cierra solo -por tiempo o por objetivo- y este
              campo no significa nada. El valor viaja igual (oculto) para no
              perder lo que ya estaba cargado. */}
          {esCargaMaxima ? (
            <Field
              label="Intentos máximos"
              name="maxAttempts"
              type="number"
              defaultValue={String(movimiento.max_attempts)}
              ayuda="Estándar de halterofilia: 3. El carril cierra solo al agotarlos."
            />
          ) : (
            <input type="hidden" name="maxAttempts" value={movimiento.max_attempts} />
          )}

          <Field
            label="Notas para el juez"
            name="notes"
            defaultValue={movimiento.notes ?? ""}
            placeholder="Opcional: estándar, altura, agarre…"
          />

          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="maxReps"
                defaultChecked={movimiento.max_reps}
                className="size-4 accent-lime-400"
              />
              Las que pueda en el tiempo restante
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="esTiebreak"
                defaultChecked={movimiento.es_tiebreak}
                className="size-4 accent-lime-400"
              />
              Marca el desempate al cerrarlo
            </label>
          </div>
        </form>

        <BotonesDeModal
          cancelar={() => setAbierto(false)}
          guardando={pending}
          error={state.error}
          guardarId={`editar-mov-${movimiento.id}`}
          mensajeDeCarga="Guardando el movimiento…"
        />
      </Modal>
    </>
  );
}
