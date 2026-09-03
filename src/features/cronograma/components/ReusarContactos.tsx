"use client";

import { useActionState, useState } from "react";
import { reusarColaboradores, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { ContactoDeLaOrganizacion } from "@/features/events/config/queries";

const inicial: FormState = { error: null };

/**
 * Reusar a quienes ya trabajaron en otras competencias de la organizacion.
 *
 * ES LO QUE HACE VIABLE INVITAR POR EVENTO. Que el acceso sea de UNA competencia
 * y no de todas es la decision correcta —se contrata a alguien para una fecha
 * sin darle el historial completo, y dos competencias simultaneas no se ven
 * entre si— pero su costo es tipear doce correos cada vez que se arma una fecha
 * nueva. Esta lista es la memoria que paga ese costo una sola vez.
 *
 * SE ORDENAN POR CUANTAS VECES TRABAJARON. Los de siempre arriba: en una lista
 * de cuarenta contactos, los doce habituales son los unicos que se van a marcar
 * y tienen que estar sin scrollear.
 *
 * "SELECCIONAR TODOS" existe porque el caso comun es exactamente ese: el mismo
 * equipo de la fecha anterior.
 */
export function ReusarContactos({
  eventId,
  contactos,
  comoJuez,
}: {
  eventId: string;
  contactos: ContactoDeLaOrganizacion[];
  /** Cambia con qué permisos entran y qué se le dice al organizador. */
  comoJuez: boolean;
}) {
  const [state, formAction] = useActionState(reusarColaboradores, inicial);
  const [elegidos, setElegidos] = useState<string[]>([]);

  if (contactos.length === 0) return null;

  const todos = elegidos.length === contactos.length;
  const que = comoJuez ? "juez" : "colaborador";

  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {comoJuez
              ? "Jueces de otras competencias"
              : "Ya trabajaron contigo"}
          </h3>
          <p className="mt-1 max-w-xl text-sm text-neutral-500">
            {comoJuez
              ? "Gente que ya juzgó en tu organización. Súmalos sin volver a escribir sus correos: el acceso sigue siendo solo de esta competencia."
              : "Gente que ya colaboró en tu organización. Entran con permiso de cargar scores; el resto se ajusta después."}
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setElegidos(todos ? [] : contactos.map((c) => c.email))
          }
          className="shrink-0 text-sm text-lime-400 hover:underline"
        >
          {todos ? "Quitar todos" : "Seleccionar todos"}
        </button>
      </div>

      <form action={formAction} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="comoJuez" value={comoJuez ? "si" : "no"} />

        <ul className="divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800">
          {contactos.map((c) => {
            const marcado = elegidos.includes(c.email);
            return (
              <li key={c.email}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-neutral-900">
                  <input
                    type="checkbox"
                    name="emails"
                    value={c.email}
                    checked={marcado}
                    onChange={() =>
                      setElegidos((antes) =>
                        antes.includes(c.email)
                          ? antes.filter((x) => x !== c.email)
                          : [...antes, c.email],
                      )
                    }
                    className="h-4 w-4 shrink-0 accent-lime-400"
                  />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {c.nombre}
                    </span>
                    {c.nombre !== c.email && (
                      <span className="block truncate text-xs text-neutral-500">
                        {c.email}
                      </span>
                    )}
                  </span>

                  <span className="shrink-0 text-right text-xs text-neutral-500">
                    <span className="block">
                      {c.veces === 1
                        ? "1 competencia"
                        : `${c.veces} competencias`}
                    </span>
                    {c.ultimaCompetencia && (
                      <span className="block truncate text-neutral-600">
                        {c.ultimaCompetencia}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {state.error && (
          <p
            role="alert"
            className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
          >
            {state.error}
          </p>
        )}

        <BotonDeEnvio
          pendienteTexto="Sumando…"
          mensajeDeCarga="Sumando colaboradores…"
          disabled={elegidos.length === 0}
          className="w-fit rounded-xl border border-neutral-700 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-neutral-900 disabled:opacity-50"
        >
          {elegidos.length === 0
            ? "Elige a quién sumar"
            : `Sumar ${elegidos.length} ${elegidos.length === 1 ? que : `${que}es`}`}
        </BotonDeEnvio>
      </form>
    </section>
  );
}
