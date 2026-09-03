"use client";

import { startTransition, useActionState, useState } from "react";
import { assignLanes, setLaneJudge, type FormState } from "../actions";
import { fechaHoraEnEvento } from "@/shared/utils/fecha";
import { useCargaMientras } from "@/shared/components/Carga";
import type {
  HeatWithLanes,
  JudgeOption,
} from "@/features/events/config/queries";

const inicial: FormState = { error: null };

export interface TeamOption {
  id: string;
  label: string;
  /** Heat donde ya está asignado, si lo está. */
  asignadoEn: string | null;
}

export function HeatCard({
  eventId,
  timezone,
  heat,
  teams,
  judges,
  canManage,
  canVerify,
}: {
  eventId: string;
  /** Huso de la competencia: la hora que importa es la del venue. */
  timezone: string;
  heat: HeatWithLanes;
  teams: TeamOption[];
  judges: JudgeOption[];
  canManage: boolean;
  canVerify: boolean;
}) {
  const [lanesState, lanesAction, guardando] = useActionState(
    assignLanes,
    inicial,
  );
  const [judgeState, judgeAction, asignandoJuez] = useActionState(
    setLaneJudge,
    inicial,
  );

  // El overlay global, no un cambio de texto local: las dos acciones se
  // invocan a mano (ver el comentario de mas abajo sobre por que no hay
  // `<form>`) y antes ninguna de las dos avisaba que algo estaba pasando —
  // "Asignar" ni siquiera se deshabilitaba mientras la asignacion de juez
  // estaba en curso.
  useCargaMientras(guardando, "Guardando los carriles…");
  useCargaMientras(asignandoJuez, "Asignando el juez…");

  const largado = heat.started_at !== null;
  const carriles = Array.from({ length: heat.lane_count }, (_, i) => i + 1);

  /*
   * Los selectores son CONTROLADOS y el estado local manda mientras se edita.
   *
   * Se siembra UNA sola vez por heat. Resincronizarlo con los props en cada
   * cambio pisaba la seleccion del organizador con datos viejos cuando el
   * refresco del servidor llegaba tarde.
   */
  const desdeProps = () =>
    Object.fromEntries(
      heat.lanes.flatMap((l) =>
        l.team_id ? [[l.lane_number, l.team_id]] : [],
      ),
    ) as Record<number, string>;

  // El juez de cada carril, por id de carril. Mismo motivo que arriba.
  const juecesDesdeProps = () =>
    Object.fromEntries(
      heat.lanes.map((l) => [l.id, l.judge_id ?? ""]),
    ) as Record<string, string>;

  const [seleccion, setSeleccion] =
    useState<Record<number, string>>(desdeProps);
  const [juezPorCarril, setJuezPorCarril] =
    useState<Record<string, string>>(juecesDesdeProps);
  const [heatSembrado, setHeatSembrado] = useState(heat.id);

  // Solo si la tarjeta pasa a representar OTRO heat. Ajustar estado durante el
  // render es el patron que recomienda React; un useEffect dispararia un render
  // de mas y ademas lo rechaza el linter.
  if (heat.id !== heatSembrado) {
    setHeatSembrado(heat.id);
    setSeleccion(desdeProps());
    setJuezPorCarril(juecesDesdeProps());
  }

  /*
   * La accion se invoca a mano, NO con <form action={...}>.
   *
   * Es el motivo por el que esta pantalla se rompio tres veces. Cuando termina
   * una accion de formulario, React 19 llama al form.reset() NATIVO (ver
   * recursivelyResetForms en react-dom). React fija el valor de un <select> por
   * propiedad y no por atributo, asi que el reset lo devuelve a la primera
   * opcion —"vacio"—. Y como el estado de React no cambio, el render siguiente
   * no encuentra ninguna diferencia que aplicar y jamas vuelve a escribir el
   * DOM: el estado decia "equipo A" y la pantalla mostraba "vacio". Recargar lo
   * arreglaba porque volvia a montar todo desde cero.
   *
   * Sin <form>, no hay reset que borre lo que el organizador acaba de guardar.
   */
  const guardarCarriles = () => {
    const datos = new FormData();
    datos.set("eventId", eventId);
    datos.set("heatId", heat.id);
    for (const numero of carriles)
      datos.set(`lane-${numero}`, seleccion[numero] ?? "");

    startTransition(() => lanesAction(datos));
  };

  // Equipos elegibles en un carril. Incluye siempre al que ya esta elegido: si
  // no, un equipo tomado en otro heat desapareceria de la lista y el selector se
  // veria vacio aunque el valor siga puesto.
  const opcionesPara = (numero: number) =>
    teams.filter(
      (t) =>
        t.asignadoEn === null ||
        t.asignadoEn === heat.id ||
        t.id === seleccion[numero],
    );

  const asignarJuez = (laneId: string) => {
    const datos = new FormData();
    datos.set("eventId", eventId);
    datos.set("laneId", laneId);
    datos.set("judgeId", juezPorCarril[laneId] ?? "");

    startTransition(() => judgeAction(datos));
  };

  return (
    <section className="rounded-2xl border border-neutral-800 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">{heat.name}</h3>
          <p className="text-sm text-neutral-500">
            {heat.lane_count} carriles
            {heat.scheduled_at &&
              ` · ${fechaHoraEnEvento(heat.scheduled_at, timezone)}`}
          </p>
        </div>
        <span
          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
            largado
              ? "bg-lime-500/15 text-lime-300"
              : "bg-neutral-800 text-neutral-400"
          }`}
        >
          {largado ? "Largado" : "Programado"}
        </span>
      </header>

      {largado ? (
        // Reasignar carriles con la carrera en curso dejaria marcajes apuntando
        // a un equipo que ya no esta ahi.
        <p className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 text-sm text-neutral-400">
          El heat ya inició: los carriles quedaron fijos.
        </p>
      ) : (
        canManage && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {carriles.map((numero) => (
                <label key={numero} className="flex items-center gap-2">
                  <span className="w-6 text-sm text-neutral-500">{numero}</span>
                  <select
                    name={`lane-${numero}`}
                    value={seleccion[numero] ?? ""}
                    onChange={(e) =>
                      setSeleccion((prev) => ({
                        ...prev,
                        [numero]: e.target.value,
                      }))
                    }
                    className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-lime-400"
                  >
                    <option value="">— vacío —</option>
                    {opcionesPara(numero).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            {lanesState.error && (
              <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                {lanesState.error}
              </p>
            )}

            <div>
              <button
                type="button"
                onClick={guardarCarriles}
                disabled={guardando}
                className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950 disabled:opacity-60"
              >
                {guardando ? "Guardando…" : "Guardar carriles"}
              </button>
            </div>
          </div>
        )
      )}

      {heat.lanes.length > 0 && canVerify && (
        <div className="mt-5 border-t border-neutral-800 pt-4">
          <h4 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            Jueces
          </h4>

          <ul className="flex flex-col gap-2">
            {heat.lanes.map((lane) => (
              <li
                key={lane.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2"
              >
                <span className="w-6 text-sm text-neutral-500">
                  {lane.lane_number}
                </span>
                <span className="flex min-w-0 basis-full items-baseline gap-2 sm:basis-auto">
                  <span className="font-mono text-sm text-neutral-300">
                    {lane.bib !== null ? `#${lane.bib}` : "—"}
                  </span>
                  <span className="truncate text-sm">
                    {lane.athletes ?? lane.teamLabel ?? ""}
                  </span>
                </span>

                <div className="flex min-w-[14rem] flex-1 items-center gap-2">
                  <select
                    name="judgeId"
                    value={juezPorCarril[lane.id] ?? ""}
                    onChange={(e) =>
                      setJuezPorCarril((prev) => ({
                        ...prev,
                        [lane.id]: e.target.value,
                      }))
                    }
                    className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-lime-400"
                  >
                    <option value="">— sin juez —</option>
                    {judges.map((j) => (
                      <option key={j.userId} value={j.userId}>
                        {j.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => asignarJuez(lane.id)}
                    disabled={asignandoJuez}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-60"
                  >
                    Asignar
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {judgeState.error && (
            <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {judgeState.error}
            </p>
          )}

          <p className="mt-3 text-xs text-neutral-600">
            Asignar aquí es opcional: el juez también puede tomar su carril
            desde su celular. Lo que no puede es tomar uno que ya tomó otro.
          </p>
        </div>
      )}
    </section>
  );
}
