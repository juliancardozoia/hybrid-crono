"use client";

import { useActionState } from "react";
import { programarHeat, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { Selector } from "@/shared/components/Selector";

/**
 * Arena y horario de un heat.
 *
 * Cada fila es su propio formulario para poder guardar de a uno: un formulario
 * unico con cuarenta heats obliga a mandar todo junto, y basta un error en uno
 * para no poder guardar ninguno.
 *
 * Las horas se muestran y se escriben en hora de PARED del evento; la
 * conversion al instante real la hace la accion con el huso de la competencia.
 */

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400";
const selector = "w-full py-2";

export function ProgramarHeat({
  eventId,
  heatId,
  nombre,
  arenas,
  arenaId,
  inicio,
  fin,
}: {
  eventId: string;
  heatId: string;
  nombre: string;
  arenas: Array<{ id: string; name: string }>;
  arenaId: string | null;
  inicio: string;
  fin: string;
}) {
  const [state, formAction] = useActionState(programarHeat, {
    error: null,
  } as FormState);

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-neutral-800 p-4"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="heatId" value={heatId} />

      <p className="font-medium">{nombre}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Arena</span>
          <Selector
            name="arenaId"
            defaultValue={arenaId ?? ""}
            className={selector}
          >
            <option value="">Sin asignar</option>
            {arenas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Selector>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Empieza</span>
          <input
            name="inicio"
            type="datetime-local"
            defaultValue={inicio}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Termina</span>
          <input
            name="fin"
            type="datetime-local"
            defaultValue={fin}
            className={campo}
          />
        </label>

        <BotonDeEnvio
          pendienteTexto="…"
          mensajeDeCarga="Guardando el horario…"
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60"
        >
          Guardar
        </BotonDeEnvio>
      </div>

      {state.error && (
        <p className="mt-2 rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
