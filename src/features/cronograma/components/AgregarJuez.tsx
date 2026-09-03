"use client";

import { useActionState, useState } from "react";
import { invitarColaborador, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";

const inicial: FormState = { error: null };

/**
 * Alta de juez.
 *
 * ES EL MISMO `event_staff`, con CERO permisos marcados. Un juez no administra
 * nada: llega el dia del evento, toma un carril y cronometra. Por eso este
 * formulario no tiene ni una casilla de permisos —darle una seria convertirlo en
 * colaborador— y por eso es tan corto: se escribe el correo y listo.
 *
 * LO UNICO QUE SE PREGUNTA ADEMAS ES A QUE CATEGORIAS. Con seis categorias
 * corriendo en dos escenarios, un juez suele cubrir una o dos; acotarlo le
 * simplifica la pantalla del celular. Vacio = todas, que es el caso de una
 * competencia chica y no deberia costar ninguna decision.
 *
 * TIENE QUE ESTAR REGISTRADO. `claim_lane` mira `event_staff_role`, que busca
 * por `user_id`: sin cuenta, la invitacion queda pendiente y el juez no aparece
 * como opcion hasta que se registre con ese correo. Decirlo aca ahorra el
 * "invite a mi juez y no le figura nada" del dia del evento.
 */
export function AgregarJuez({
  eventId,
  divisiones,
}: {
  eventId: string;
  divisiones: Array<{ id: string; name: string }>;
}) {
  const [state, formAction] = useActionState(invitarColaborador, inicial);
  const [todas, setTodas] = useState(true);
  const [elegidas, setElegidas] = useState<string[]>([]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="eventId" value={eventId} />

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">
          Email del juez
        </span>
        <input
          name="email"
          type="email"
          required
          placeholder="juez@correo.com"
          className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none transition-colors focus:border-lime-400"
        />
        <span className="text-xs text-neutral-500">
          Tiene que estar registrado en la plataforma. Si todavía no tiene
          cuenta, la invitación queda pendiente y se activa sola cuando se
          registre con ese correo.
        </span>
      </label>

      {divisiones.length > 0 && (
        <fieldset>
          <legend className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">
            Categorías que va a juzgar
          </legend>
          <p className="mt-2 mb-3 text-sm text-neutral-500">
            Déjalo vacío si va a juzgar cualquier carril.
          </p>

          <div className="flex flex-col gap-1">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-neutral-900">
              <input
                type="checkbox"
                checked={todas}
                onChange={() => {
                  setTodas(true);
                  setElegidas([]);
                }}
                className="h-4 w-4 shrink-0 accent-lime-400"
              />
              <span
                className={`text-sm ${todas ? "font-medium text-lime-400" : ""}`}
              >
                Todas las categorías
              </span>
            </label>

            {divisiones.map((d) => (
              <label
                key={d.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-neutral-900"
              >
                <input
                  type="checkbox"
                  name="divisions"
                  value={d.id}
                  checked={elegidas.includes(d.id)}
                  onChange={() => {
                    setElegidas((antes) =>
                      antes.includes(d.id)
                        ? antes.filter((x) => x !== d.id)
                        : [...antes, d.id],
                    );
                    setTodas(false);
                  }}
                  className="h-4 w-4 shrink-0 accent-lime-400"
                />
                <span className="text-sm">{d.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {state.error}
        </p>
      )}

      <BotonDeEnvio
        pendienteTexto="Invitando…"
        mensajeDeCarga="Invitando al juez…"
        className="w-fit rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
      >
        Agregar juez
      </BotonDeEnvio>
    </form>
  );
}
