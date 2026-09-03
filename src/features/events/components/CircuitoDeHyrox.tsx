"use client";

import { useActionState } from "react";
import { createCourseTemplate } from "@/features/events/config/actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { FormState } from "@/features/events/config/actions";

const inicial: FormState = { error: null };

/**
 * El circuito de una carrera hibrida, creado desde el asistente.
 *
 * SIN SACAR A NADIE DEL ASISTENTE. Antes, una carrera hibrida sin circuito
 * mostraba un cartel con un enlace a la pestaña de circuito: se llegaba a otra
 * pantalla, con otra navegacion, y sin manera obvia de volver al paso donde uno
 * estaba. Sacar a alguien de un asistente a mitad de camino es la forma mas
 * segura de que no lo termine.
 *
 * DOS BOTONES Y NINGUN FORMULARIO. El circuito de Hyrox son SIEMPRE las mismas
 * dieciseis estaciones —cuatro corridas y ocho estaciones alternadas— asi que
 * preguntarle el nombre a alguien que va a escribir "Hyrox" es un campo de mas.
 * Quien corre otra cosa crea uno vacio y lo arma en la pestaña de circuito, que
 * es donde vive el editor de segmentos.
 */
export function CircuitoDeHyrox({ eventId }: { eventId: string }) {
  const [state, formAction] = useActionState(createCourseTemplate, inicial);

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/30 p-5">
      <div>
        <h3 className="font-semibold">
          Esta competencia todavía no tiene circuito
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Una carrera híbrida se cronometra recorriendo un circuito. Puedes
          empezar por el de Hyrox —16 estaciones— y ajustarlo después, o crear
          uno vacío y armarlo a tu gusto.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <form action={formAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="name" value="Hyrox" />
          <input type="hidden" name="preset" value="hyrox" />
          <BotonDeEnvio
            pendienteTexto="Creando…"
            mensajeDeCarga="Creando el circuito…"
            className="rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
          >
            Usar el circuito Hyrox
          </BotonDeEnvio>
        </form>

        <form action={formAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="name" value="Circuito" />
          <input type="hidden" name="preset" value="vacio" />
          <BotonDeEnvio
            pendienteTexto="Creando…"
            mensajeDeCarga="Creando el circuito…"
            className="rounded-xl border border-neutral-700 px-5 py-2.5 text-sm font-bold text-neutral-300 transition-colors hover:bg-neutral-900 disabled:opacity-60"
          >
            Crear uno vacío
          </BotonDeEnvio>
        </form>
      </div>

      {state.error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </section>
  );
}
