"use client";

import { startTransition, useActionState, useState } from "react";
import { assignLanes, setLaneJudge, type FormState } from "../actions";
import { fechaHoraEnEvento } from "@/shared/utils/fecha";
import { useCargaMientras } from "@/shared/components/Carga";
import { Selector } from "@/shared/components/Selector";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import type {
  HeatWithLanes,
  JudgeOption,
} from "@/features/events/config/queries";

const inicial: FormState = { error: null };

export interface TeamOption {
  id: string;
  label: string;
  /**
   * En qué heat ya está asignado, POR PRUEBA (`workout_id` → `heat_id`).
   *
   * Era un solo heat, y alcanzaba mientras un evento tuviera una sola prueba.
   * Con varias es incorrecto: un equipo corre una vez por PRUEBA, no una vez
   * por evento (`lanes_team_once_per_workout`), así que estar en el heat del
   * WOD 1 no puede sacarlo del selector del WOD 2.
   */
  asignadoEn: Record<string, string>;
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
  //
  // "Tomado" se mide DENTRO DE ESTA PRUEBA. Correr el WOD 1 y el WOD 2 es lo
  // normal; lo que no se puede es correr el mismo WOD dos veces.
  const opcionesPara = (numero: number) =>
    teams.filter((t) => {
      const yaEn = t.asignadoEn[heat.workout_id];
      return yaEn === undefined || yaEn === heat.id || t.id === seleccion[numero];
    });

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
                  <Selector
                    name={`lane-${numero}`}
                    value={seleccion[numero] ?? ""}
                    onChange={(e) =>
                      setSeleccion((prev) => ({
                        ...prev,
                        [numero]: e.target.value,
                      }))
                    }
                    className="flex-1 py-2 text-sm"
                  >
                    <option value="">— vacío —</option>
                    {opcionesPara(numero).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Selector>
                </label>
              ))}
            </div>

            {lanesState.error && (
              <MensajeDeError>{lanesState.error}</MensajeDeError>
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

          {largado ? (
            // El heat ya largó: reasignar el juez desde acá dejaría al
            // celular del juez viejo cronometrando un carril que ya no es
            // suyo, sin que nadie se entere hasta que se compare el log. Una
            // vez largado, transferir un carril es una decisión que pasa por
            // Control (torre de heats / transfer_lane), no por esta pantalla
            // de armado previo — esta lista queda de solo lectura.
            <ul className="flex flex-col gap-2">
              {heat.lanes.map((lane) => (
                <li
                  key={lane.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                >
                  <span className="w-6 text-neutral-500">{lane.lane_number}</span>
                  <span className="font-mono text-neutral-300">
                    {lane.bib !== null ? `#${lane.bib}` : "—"}
                  </span>
                  <span className="truncate">{lane.athletes ?? lane.teamLabel ?? ""}</span>
                  <span className="ml-auto text-neutral-500">
                    {judges.find((j) => j.userId === lane.judge_id)?.label ?? "— sin juez —"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <>
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
                      <Selector
                        name="judgeId"
                        value={juezPorCarril[lane.id] ?? ""}
                        onChange={(e) =>
                          setJuezPorCarril((prev) => ({
                            ...prev,
                            [lane.id]: e.target.value,
                          }))
                        }
                        className="flex-1 py-1.5 text-sm"
                      >
                        <option value="">— sin juez —</option>
                        {judges.map((j) => (
                          <option key={j.userId} value={j.userId}>
                            {j.label}
                          </option>
                        ))}
                      </Selector>
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
                <MensajeDeError className="mt-3">{judgeState.error}</MensajeDeError>
              )}

              <p className="mt-3 text-xs text-neutral-600">
                Asignar aquí es opcional: el juez también puede tomar su carril
                desde su celular. Lo que no puede es tomar uno que ya tomó otro.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
