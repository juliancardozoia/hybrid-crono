"use client";

import { useActionState, useState } from "react";
import { agregarBloque, type FormState } from "../actions";
import { Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { claseDeBoton } from "@/shared/components/Boton";
import type { BlockKind, TimeScheme } from "@/lib/supabase/types";

const inicial: FormState = { error: null };

/**
 * Alta de un bloque, con solo los campos que el TIPO elegido de verdad usa.
 *
 * Antes era un `SimpleForm` estatico que mostraba Rondas, Duracion, Descanso
 * y Cap siempre, sin mirar el Tipo: un bloque de Descanso —que solo usa
 * Duracion como su largo— mostraba tambien Rondas, Descanso y Cap, ninguno de
 * los cuales significa algo para el (`agregarBloque` ya los ignora server-side
 * para Descanso, pero la pantalla no lo decia). Ahora el Tipo es estado del
 * componente y decide que se pide.
 *
 * "Cap de este bloque (min)" SIGUE disponible para cualquier bloque que no
 * sea Descanso, sin importar el esquema de la prueba: es justo lo que hace
 * falta para un For Time con un descanso obligatorio en el medio (bloque de
 * trabajo con cap -> descanso -> bloque de trabajo), y sacarlo de la creacion
 * hubiera obligado a crear el bloque primero y recien despues ir a "Editar
 * bloque" a cargarle el cap. Su ayuda ya explica que solo cobra sentido si la
 * prueba tiene algun bloque de Descanso.
 *
 * LA EXCEPCION ES `sin_reloj` (carga maxima): ese esquema no avanza por
 * pasos ni por segmentos -se cierra solo al agotar los intentos de
 * levantamiento (`maxAttempts`)-, asi que ni el cap de un bloque ni sus
 * Rondas se llegan a evaluar NUNCA (ver `wod.ts`, el bloque de `sin_reloj`
 * que nunca toca `stepIndex`). A diferencia de AMRAP o EMOM -donde el cap
 * puede servir en una estructura de varios bloques con descanso en el
 * medio- en carga maxima no hay ninguna estructura que lo haga funcionar.
 *
 * Duracion y Descanso (en un bloque que NO es Descanso) son "solo intervalos"
 * -- literalmente lo que decian sus placeholders-- asi que solo se piden
 * cuando la prueba es EMOM/Tabata.
 */
export function NuevoBloque({
  eventId,
  partId,
  timeScheme,
}: {
  eventId: string;
  partId: string;
  timeScheme: TimeScheme;
}) {
  const [state, formAction] = useActionState(agregarBloque, inicial);
  const [kind, setKind] = useState<BlockKind>("trabajo");

  const esDescanso = kind === "descanso";
  const esIntervalos = timeScheme === "intervalos";
  const esCargaMaxima = timeScheme === "sin_reloj";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="partId" value={partId} />

      <FieldRow>
        <Select
          label="Tipo"
          name="kind"
          defaultValue="trabajo"
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
            placeholder="1 (vacío = sin límite, si la prueba es AMRAP)"
          />
        )}
      </FieldRow>

      {esDescanso ? (
        <Field
          label="Duración (seg)"
          name="duracionSegundos"
          type="number"
          placeholder="Cuánto dura el descanso"
        />
      ) : (
        esIntervalos && (
          <FieldRow>
            <Field label="Duración (seg)" name="duracionSegundos" type="number" />
            <Field label="Descanso (seg)" name="descansoSegundos" type="number" />
          </FieldRow>
        )
      )}

      {!esDescanso && !esCargaMaxima && (
        <Field
          label="Cap de este bloque (min)"
          name="capMinutos"
          type="number"
          placeholder="Vacío = sin tope propio"
          ayuda="Se mide desde que ARRANCA este bloque, no desde la largada del heat. Solo tiene efecto si la prueba tiene algún bloque de Descanso."
        />
      )}

      {state.error && <MensajeDeError>{state.error}</MensajeDeError>}

      <div>
        <BotonDeEnvio
          pendienteTexto="Agregando…"
          mensajeDeCarga="Agregando el bloque…"
          className={claseDeBoton({ variante: "primary" })}
        >
          Agregar bloque
        </BotonDeEnvio>
      </div>
    </form>
  );
}
