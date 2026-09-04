"use client";

import { useActionState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import {
  publishResults,
  recomputeEvent,
  verifyResults,
  type FormState,
} from "../actions";
import { estaPendienteDeVerificar } from "../lib/estado";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { Selector } from "@/shared/components/Selector";
import type { QueueRow } from "../queries";

const inicial: FormState = { error: null, mensaje: null };

function Boton({
  label,
  tone = "neutral",
  mensajeDeCarga,
}: {
  label: string;
  tone?: "neutral" | "primary";
  mensajeDeCarga: string;
}) {
  return (
    <BotonDeEnvio
      pendienteTexto="Trabajando…"
      mensajeDeCarga={mensajeDeCarga}
      className={`rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-60 ${
        tone === "primary"
          ? "bg-lime-400 text-lime-950 hover:bg-lime-300"
          : "border border-neutral-700 hover:bg-neutral-900"
      }`}
    >
      {label}
    </BotonDeEnvio>
  );
}

function Aviso({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
        {state.error}
      </p>
    );
  }
  if (state.mensaje) {
    return (
      <p className="mt-3 rounded-xl border border-lime-500/40 bg-lime-500/10 p-3 text-sm text-lime-300">
        {state.mensaje}
      </p>
    );
  }
  return null;
}

export function PanelVerificacion({
  eventId,
  cola,
  divisiones,
  canManage,
  yaPublicado,
}: {
  eventId: string;
  cola: QueueRow[];
  divisiones: Array<{ id: string; name: string }>;
  canManage: boolean;
  yaPublicado: boolean;
}) {
  const [verifyState, verifyAction] = useActionState(verifyResults, inicial);
  const [publishState, publishAction] = useActionState(publishResults, inicial);
  const [recomputeState, recomputeAction] = useActionState(
    recomputeEvent,
    inicial,
  );

  const pendientes = cola.filter(estaPendienteDeVerificar).length;
  const conProblemas = cola.filter(
    (c) =>
      c.anomalies.length > 0 ||
      c.voidedCount > 0 ||
      c.startedOffline ||
      c.eventCount === 0,
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-neutral-800 p-5">
        <h2 className="font-semibold">1 · Recalcular</h2>
        <p className="mt-1 mb-3 text-sm text-neutral-500">
          Reconstruye los resultados desde el log de marcajes. Ejecuta esto si
          anulaste algún marcaje o si algún juez sincronizó tarde.
        </p>
        <form action={recomputeAction}>
          <input type="hidden" name="eventId" value={eventId} />
          <Boton
            label="Recalcular todo el evento"
            mensajeDeCarga="Recalculando el evento…"
          />
        </form>
        <Aviso state={recomputeState} />
      </section>

      <section>
        <h2 className="mb-3 font-semibold">
          2 · Revisar
          {conProblemas.length > 0 && (
            <span className="ml-2 text-sm font-normal text-amber-400">
              {conProblemas.length} carril(es) con algo para mirar
            </span>
          )}
        </h2>

        {conProblemas.length === 0 ? (
          <p className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            Nada llamativo: ningún carril quedó sin marcajes, sin anomalías ni
            con marcajes anulados.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {conProblemas.map((c) => (
              <li
                key={c.laneId}
                className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-mono text-lg font-bold tabular-nums">
                      #{c.bib ?? "—"}
                    </span>
                    <span className="ml-2 text-xs text-neutral-500">
                      {[c.divisionName, c.heatName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums">
                    {c.totalMs !== null ? formatElapsed(c.totalMs) : c.status}
                  </span>
                </div>

                <ul className="mt-2 space-y-1 text-sm text-amber-200">
                  {c.eventCount === 0 && (
                    <li>⚠ No llegó ningún marcaje de este carril.</li>
                  )}
                  {c.startedOffline && (
                    <li>
                      ⚠ El heat inició sin señal: la salida es provisional.
                    </li>
                  )}
                  {c.voidedCount > 0 && (
                    <li>
                      ⚠ {c.voidedCount} marcaje(s) anulados por el juez
                      principal.
                    </li>
                  )}
                  {c.anomalies.map((a, i) => (
                    <li key={i}>⚠ {a.message}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-neutral-800 p-5">
        <h2 className="font-semibold">3 · Verificar</h2>
        <p className="mt-1 mb-3 text-sm text-neutral-500">
          Deja constancia de que la organización revisó estos tiempos. No cambia
          ningún resultado.
          {pendientes > 0 && ` Quedan ${pendientes} sin verificar.`}
        </p>
        <form action={verifyAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="eventId" value={eventId} />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm">Categoría</span>
            <Selector
              name="divisionId"
              className="py-2.5 text-sm"
            >
              <option value="">Todas</option>
              {divisiones.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Selector>
          </label>
          <Boton
            label="Marcar como verificados"
            mensajeDeCarga="Verificando…"
          />
        </form>
        <Aviso state={verifyState} />
      </section>

      {canManage && (
        <section className="rounded-2xl border border-neutral-800 p-5">
          <h2 className="font-semibold">4 · Publicar</h2>
          <p className="mt-1 mb-3 text-sm text-neutral-500">
            Congela el resultado oficial en una copia inmutable. Desde ese
            momento el podio anunciado ya no depende de la tabla de resultados:
            si después se corrige algo, hay que publicar de nuevo y queda
            registrado aparte.
            {yaPublicado && " Este evento ya tiene resultados publicados."}
          </p>
          <form
            action={publishAction}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="eventId" value={eventId} />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm">Categoría</span>
              <Selector
                name="divisionId"
                className="py-2.5 text-sm"
              >
                <option value="">Todo el evento</option>
                {divisiones.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Selector>
            </label>
            <Boton
              label="Publicar oficiales"
              tone="primary"
              mensajeDeCarga="Publicando los resultados oficiales…"
            />
          </form>
          <Aviso state={publishState} />
        </section>
      )}
    </div>
  );
}
