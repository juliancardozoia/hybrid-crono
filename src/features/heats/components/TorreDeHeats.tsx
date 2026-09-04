"use client";

import { useMemo, useState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import { horaEnEvento } from "@/shared/utils/fecha";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { RelojDeHeat } from "./RelojDeHeat";

export interface CarrilVista {
  laneId: string;
  laneNumber: number;
  bib: number | null;
  athletes: string | null;
  teamLabel: string | null;
  judgeId: string | null;
  judgeName: string | null;
  status: string;
  totalMs: number | null;
  eventCount: number;
  /** Tiene atleta, el heat largó y todavía no está en un estado terminal. */
  puedeMarcarDnf: boolean;
}

export interface HeatVista {
  id: string;
  name: string;
  startedAt: string | null;
  endedAt: string | null;
  startSource: string | null;
  divisionId: string | null;
  divisionName: string | null;
  marcajesTotales: number;
  conAtletaCount: number;
  sinJuezCount: number;
  lanes: CarrilVista[];
}

interface FormState {
  error: string | null;
}

type AccionHeat = (
  eventId: string,
  heatId: string,
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

type AccionCarril = (
  eventId: string,
  laneId: string,
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

/**
 * La torre de heats de la pantalla de control: filtro por categoría, reloj
 * en vivo del heat en curso, hora de cierre una vez termina, y DNF por
 * carril.
 *
 * ES UN COMPONENTE DE CLIENTE porque el filtro y el reloj en vivo lo
 * necesitan. Los datos ya vienen resueltos en un arreglo plano desde el
 * servidor —sin Maps, que no cruzan bien esa frontera— porque page.tsx ya
 * tiene ahí mismo RLS de su lado y no hay motivo para repetir esas consultas
 * en el cliente.
 */
export function TorreDeHeats({
  eventId,
  timezone,
  divisiones,
  heats,
  largar,
  deshacer,
  marcarDnfAccion,
}: {
  eventId: string;
  timezone: string;
  divisiones: Array<{ id: string; name: string }>;
  heats: HeatVista[];
  largar: AccionHeat;
  deshacer: AccionHeat;
  marcarDnfAccion: AccionCarril;
}) {
  const [divisionId, setDivisionId] = useState("");

  const divisionesConHeat = useMemo(() => {
    const ids = new Set(heats.map((h) => h.divisionId).filter((x): x is string => Boolean(x)));
    return divisiones.filter((d) => ids.has(d.id));
  }, [divisiones, heats]);

  const visibles = divisionId ? heats.filter((h) => h.divisionId === divisionId) : heats;

  return (
    <div className="flex flex-col gap-4">
      {divisionesConHeat.length > 1 && (
        <label className="flex items-center gap-2 self-start text-sm">
          <span className="text-neutral-500">Categoría</span>
          <select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            {divisionesConHeat.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {visibles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          {heats.length === 0 ? "No hay heats armados todavía." : "Ninguna categoría coincide."}
        </p>
      ) : (
        visibles.map((heat) => (
          <TarjetaDeHeat
            key={heat.id}
            eventId={eventId}
            timezone={timezone}
            heat={heat}
            largar={largar}
            deshacer={deshacer}
            marcarDnfAccion={marcarDnfAccion}
          />
        ))
      )}
    </div>
  );
}

function TarjetaDeHeat({
  eventId,
  timezone,
  heat,
  largar,
  deshacer,
  marcarDnfAccion,
}: {
  eventId: string;
  timezone: string;
  heat: HeatVista;
  largar: AccionHeat;
  deshacer: AccionHeat;
  marcarDnfAccion: AccionCarril;
}) {
  const enCurso = Boolean(heat.startedAt) && !heat.endedAt;

  return (
    <section className="rounded-2xl border border-neutral-800 p-4 sm:p-5">
      {/*
        En celular el titulo y la accion van apilados, y el boton ocupa el
        ancho completo. Antes compartian una fila con flex-wrap y el boton
        quedaba flotando al medio, sin alinearse ni a un lado ni al otro.
      */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-semibold">
            {heat.name}
            {heat.divisionName && (
              <span className="ml-2 text-xs font-normal text-neutral-500">
                {heat.divisionName}
              </span>
            )}
          </h2>
          <p className="text-sm text-neutral-500">
            {!heat.startedAt ? (
              "Sin iniciar"
            ) : heat.endedAt ? (
              <>Finalizó {horaEnEvento(heat.endedAt, timezone)}</>
            ) : (
              <>
                Inició {horaEnEvento(heat.startedAt, timezone)} ·{" "}
                <RelojDeHeat startedAtIso={heat.startedAt} className="font-mono text-lime-400" />
              </>
            )}
            {heat.startSource === "device_offline" && (
              <span className="ml-2 text-amber-400">salida provisional</span>
            )}
          </p>
        </div>

        {!heat.startedAt ? (
          <LargarHeat eventId={eventId} heat={heat} largar={largar} />
        ) : (
          heat.marcajesTotales === 0 && (
            // Todavia no llego ningun marcaje: se puede deshacer sin
            // destruir tiempos de nadie.
            <div className="shrink-0">
              <FormularioDeEstado
                accion={deshacer.bind(null, eventId, heat.id)}
                estadoInicial={{ error: null }}
                etiqueta="Deshacer inicio"
                mensajeDeCarga="Deshaciendo el inicio del heat…"
                className="w-full rounded-xl border border-neutral-700 px-4 py-2.5 text-sm text-neutral-400 hover:bg-neutral-900 sm:w-auto"
              />
            </div>
          )
        )}
      </header>

      {/*
        Cada carril es una fila de tres columnas fijas: numero, quien
        corre y su juez, y el estado. Las dos celdas de texto van en dos
        lineas para no pelear por el ancho, asi la tabla se lee igual en
        un celular de 360px que en una pantalla grande.
      */}
      <ul className="mt-4 divide-y divide-neutral-800">
        {heat.lanes.map((lane) => {
          const tieneTiempo = lane.totalMs !== null;

          return (
            <li key={lane.laneId} className="flex items-center gap-3 py-3">
              <span className="w-6 shrink-0 text-center font-mono text-sm text-neutral-600">
                {lane.laneNumber}
              </span>

              <div className="min-w-0 flex-1">
                {/*
                  Quien corre va primero y con el dorsal al lado. Antes
                  estaba solo el dorsal y debajo el juez, y como el juez a
                  veces aparece con su email, un numero sobre un email se
                  leia como si el email fuera del atleta.
                */}
                <p className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-bold tabular-nums text-neutral-300">
                    {lane.bib !== null ? `#${lane.bib}` : "—"}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {lane.athletes ?? lane.teamLabel ?? (
                      <span className="text-neutral-600">carril libre</span>
                    )}
                  </span>
                </p>
                <p className="truncate text-xs">
                  {lane.judgeId ? (
                    <span className="text-neutral-500">Juez: {lane.judgeName}</span>
                  ) : (
                    <span className="text-amber-400">sin juez</span>
                  )}
                  {lane.athletes && lane.teamLabel && (
                    <span className="text-neutral-600"> · {lane.teamLabel}</span>
                  )}
                </p>
              </div>

              {lane.puedeMarcarDnf && (
                <FormularioDeEstado
                  accion={marcarDnfAccion.bind(null, eventId, lane.laneId)}
                  estadoInicial={{ error: null }}
                  etiqueta="DNF"
                  pendienteTexto="…"
                  mensajeDeCarga="Marcando DNF…"
                  title="Marcar como no presentado / no terminó"
                  className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-400 hover:border-red-500/40 hover:text-red-300"
                />
              )}

              <div className="shrink-0 text-right">
                <p className="font-mono text-sm tabular-nums">
                  {tieneTiempo ? (
                    formatElapsed(lane.totalMs!)
                  ) : (
                    <EstadoCarril estado={lane.status} />
                  )}
                </p>
                <p className="text-xs text-neutral-600">
                  {lane.eventCount > 0 || lane.status !== "idle"
                    ? `${lane.eventCount} marcajes`
                    : "sin datos"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {enCurso && (
        <p className="mt-3 text-xs text-neutral-600">
          El reloj sigue mientras el heat esté en curso. Cierra solo cuando todos los carriles con
          atleta terminan, capean o quedan en DNF/DQ.
        </p>
      )}
    </section>
  );
}

/**
 * Boton de largada.
 *
 * Se deshabilita hasta que TODOS los carriles con atleta tengan juez. La base lo
 * rechaza igual, pero un boton gris que dice por que es mucho mejor que un
 * click que falla en silencio: es la regla de la competencia, no un capricho de
 * la app. Ningun atleta corre sin alguien que le tome los parciales.
 */
function LargarHeat({
  eventId,
  heat,
  largar,
}: {
  eventId: string;
  heat: HeatVista;
  largar: AccionHeat;
}) {
  const listo = heat.conAtletaCount > 0 && heat.sinJuezCount === 0;

  return (
    // En celular ocupa el ancho completo y el texto va alineado a la izquierda,
    // como el resto de la tarjeta. Recien en pantalla ancha se va a la derecha.
    <div className="shrink-0 sm:max-w-[17rem] sm:text-right">
      <FormularioDeEstado
        accion={largar.bind(null, eventId, heat.id)}
        estadoInicial={{ error: null }}
        etiqueta="INICIAR HEAT"
        mensajeDeCarga="Largando el heat…"
        disabled={!listo}
        className="w-full rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:py-2.5"
      />
      {!listo && (
        <p className="mt-2 text-xs text-amber-400">
          {heat.conAtletaCount === 0
            ? "Este heat no tiene atletas en sus carriles."
            : `Faltan ${heat.sinJuezCount} juez/jueces: cada atleta necesita el suyo antes de iniciar.`}
        </p>
      )}
    </div>
  );
}

function EstadoCarril({ estado }: { estado: string }) {
  const copy: Record<string, { texto: string; clase: string }> = {
    idle: { texto: "esperando", clase: "text-neutral-600" },
    running: { texto: "en carrera", clase: "text-lime-400" },
    finished: { texto: "terminó", clase: "text-emerald-400" },
    dnf: { texto: "DNF", clase: "text-neutral-500" },
    dq: { texto: "DQ", clase: "text-red-400" },
  };
  const c = copy[estado] ?? { texto: estado, clase: "text-neutral-500" };
  return <span className={`text-xs ${c.clase}`}>{c.texto}</span>;
}
