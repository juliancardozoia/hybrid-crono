"use client";

import { useState, useTransition } from "react";
import { guardarScore } from "../actions";
import { formatElapsed } from "@/shared/timing/clock";
import type { ScoreStatusDb, ScoreUnitDb } from "@/lib/supabase/types";

/**
 * Carga manual de resultados, fila por fila.
 *
 * POR QUE NO ES UN <form action={...}>
 *
 * React 19 llama al form.reset() NATIVO cuando termina una accion de
 * formulario. Como React fija el valor de un input por propiedad y no por
 * atributo, el reset lo vacia; y como el estado de React no cambio, el render
 * siguiente no encuentra ninguna diferencia que aplicar y nunca vuelve a
 * escribir el DOM. El score quedaria guardado en la base y borrado en pantalla,
 * que es exactamente el sintoma que ya costo tres intentos en HeatCard.
 *
 * Por eso la accion se invoca a mano dentro de startTransition y el valor lo
 * gobierna el estado de este componente.
 */

export interface FilaDeScore {
  teamId: string;
  bib: number;
  nombre: string;
  divisionName: string;
  status: ScoreStatusDb;
  value: number | null;
  reps: number | null;
  capValue: number | null;
  tiebreak: number | null;
}

const ESTADOS: Array<{ value: ScoreStatusDb; label: string }> = [
  { value: "valido", label: "Válido" },
  { value: "capeado", label: "Capeado" },
  { value: "dnf", label: "DNF" },
  { value: "dq", label: "DQ" },
  { value: "pendiente", label: "Sin cargar" },
];

const UNIDAD_CORTA: Record<ScoreUnitDb, string> = {
  tiempo: "mm:ss.cc",
  reps: "reps",
  rondas: "rondas",
  rondas_reps: "rondas",
  carga: "kg",
  distancia: "m",
  calorias: "cal",
  puntos: "pts",
};

/** Muestra el valor guardado tal como se escribe, no en milisegundos crudos. */
function comoTexto(unidad: ScoreUnitDb, valor: number | null): string {
  if (valor === null) return "";
  if (unidad === "tiempo") return formatElapsed(valor);
  return String(valor);
}

const campo =
  "w-full rounded-lg border border-neutral-700 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-lime-400 disabled:opacity-40";
const selector =
  "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-lime-400";

export function GrillaDeScores({
  eventId,
  partId,
  scoreUnit,
  tieneCap,
  tieneDesempate,
  filas,
}: {
  eventId: string;
  partId: string;
  scoreUnit: ScoreUnitDb;
  tieneCap: boolean;
  tieneDesempate: boolean;
  filas: FilaDeScore[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-500">
        {filas.filter((f) => f.status === "pendiente").length} de {filas.length} sin cargar
      </p>
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {filas.map((fila) => (
          <Fila
            key={fila.teamId}
            eventId={eventId}
            partId={partId}
            scoreUnit={scoreUnit}
            tieneCap={tieneCap}
            tieneDesempate={tieneDesempate}
            inicial={fila}
          />
        ))}
      </ul>
    </div>
  );
}

function Fila({
  eventId,
  partId,
  scoreUnit,
  tieneCap,
  tieneDesempate,
  inicial,
}: {
  eventId: string;
  partId: string;
  scoreUnit: ScoreUnitDb;
  tieneCap: boolean;
  tieneDesempate: boolean;
  inicial: FilaDeScore;
}) {
  const [status, setStatus] = useState<ScoreStatusDb>(inicial.status);
  const [valor, setValor] = useState(comoTexto(scoreUnit, inicial.value));
  const [reps, setReps] = useState(inicial.reps === null ? "" : String(inicial.reps));
  const [capValue, setCapValue] = useState(
    inicial.capValue === null ? "" : String(inicial.capValue),
  );
  const [desempate, setDesempate] = useState(comoTexto("tiempo", inicial.tiebreak));
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [pendiente, startTransition] = useTransition();

  function guardar() {
    const formData = new FormData();
    formData.set("eventId", eventId);
    formData.set("partId", partId);
    formData.set("teamId", inicial.teamId);
    formData.set("scoreUnit", scoreUnit);
    formData.set("status", status);
    formData.set("value", valor);
    formData.set("reps", reps);
    formData.set("capValue", capValue);
    formData.set("tiebreak", desempate);

    setError(null);
    setGuardado(false);

    startTransition(async () => {
      const resultado = await guardarScore({ error: null }, formData);
      if (resultado.error) setError(resultado.error);
      else setGuardado(true);
    });
  }

  const cargaValor = status === "valido";
  const cargaCap = status === "capeado";

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline gap-3">
        <span className="font-mono tabular-nums text-neutral-400">#{inicial.bib}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{inicial.nombre}</span>
        <span className="text-xs text-neutral-500">{inicial.divisionName}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Estado</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ScoreStatusDb)}
            className={selector}
          >
            {ESTADOS.filter((e) => e.value !== "capeado" || tieneCap).map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">
            {cargaCap ? "Repeticiones alcanzadas" : `Resultado (${UNIDAD_CORTA[scoreUnit]})`}
          </span>
          <input
            value={cargaCap ? capValue : valor}
            onChange={(e) => (cargaCap ? setCapValue(e.target.value) : setValor(e.target.value))}
            disabled={!cargaValor && !cargaCap}
            placeholder={scoreUnit === "tiempo" ? "12:34.56" : ""}
            className={campo}
          />
        </label>

        {scoreUnit === "rondas_reps" ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Reps de la ronda parcial</span>
            <input
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              disabled={!cargaValor}
              className={campo}
            />
          </label>
        ) : tieneDesempate ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-500">Desempate (mm:ss)</span>
            <input
              value={desempate}
              onChange={(e) => setDesempate(e.target.value)}
              className={campo}
            />
          </label>
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={guardar}
          disabled={pendiente}
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60"
        >
          {pendiente ? "…" : guardado ? "✓" : "Guardar"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1 text-sm text-red-300">
          {error}
        </p>
      )}
    </li>
  );
}
