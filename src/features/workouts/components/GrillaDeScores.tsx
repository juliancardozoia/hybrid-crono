"use client";

import { useState, useTransition } from "react";
import { corregirScore, guardarScore } from "../actions";
import { formatElapsed } from "@/shared/timing/clock";
import { Boton } from "@/shared/components/Boton";
import { Selector } from "@/shared/components/Selector";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import type { CaptureMode, ScoreStatusDb, ScoreUnitDb } from "@/lib/supabase/types";

/**
 * Carga y correccion de resultados, fila por fila.
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
 *
 * DOS MODOS, NO DOS COMPONENTES: "cargar" (pruebas manuales, guardarScore) y
 * "corregir" (pruebas en vivo, corregir_workout_score via corregirScore) son
 * la MISMA grilla porque las dos preguntas son la misma pregunta ("que
 * resultado tiene este equipo") en dos momentos distintos. Lo que cambia es
 * la accion que se llama, si hace falta motivo, y si hay algo para editar
 * cuando el juez todavia no genero ningun resultado.
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
  /** `null` cuando todavia no hay ningun resultado -sea manual o del juez-
   *  cargado para este equipo en esta prueba. */
  source: CaptureMode | null;
  corregidoEn: string | null;
  corregidoPorNombre: string | null;
  heatId: string | null;
  heatName: string | null;
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

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const campo =
  "w-full rounded-lg border border-neutral-700 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-lime-400 disabled:opacity-40";
const selector = "w-full py-1.5 text-sm";

export function GrillaDeScores({
  eventId,
  partId,
  scoreUnit,
  tieneCap,
  tieneDesempate,
  modo,
  filas,
}: {
  eventId: string;
  partId: string;
  scoreUnit: ScoreUnitDb;
  tieneCap: boolean;
  tieneDesempate: boolean;
  /** "cargar": la prueba se captura a mano (upsert_workout_score). "corregir":
   *  la prueba se juzga en vivo, solo se puede ajustar un resultado que el
   *  juez ya produjo -nunca crear uno de cero aca-. */
  modo: "cargar" | "corregir";
  filas: FilaDeScore[];
}) {
  const heats = [
    ...new Map(
      filas
        .filter((f): f is FilaDeScore & { heatId: string; heatName: string } =>
          Boolean(f.heatId && f.heatName),
        )
        .map((f) => [f.heatId, f.heatName]),
    ),
  ];
  const [heatFiltro, setHeatFiltro] = useState("");
  const visibles = heatFiltro ? filas.filter((f) => f.heatId === heatFiltro) : filas;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-neutral-500">
          {modo === "cargar"
            ? `${visibles.filter((f) => f.status === "pendiente").length} de ${visibles.length} sin cargar`
            : `${visibles.filter((f) => f.source !== null).length} de ${visibles.length} con resultado del juez`}
        </p>
        {heats.length > 1 && (
          <Selector
            value={heatFiltro}
            onChange={(e) => setHeatFiltro(e.target.value)}
            className="w-48 py-1.5 text-sm"
          >
            <option value="">Todos los heats</option>
            {heats.map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </Selector>
        )}
      </div>
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {visibles.map((fila) => (
          <Fila
            key={fila.teamId}
            eventId={eventId}
            partId={partId}
            scoreUnit={scoreUnit}
            tieneCap={tieneCap}
            tieneDesempate={tieneDesempate}
            modo={modo}
            inicial={fila}
          />
        ))}
      </ul>
    </div>
  );
}

const ORIGEN_LABEL: Record<CaptureMode, string> = {
  manual: "Manual",
  en_vivo: "Juez",
};

function Fila({
  eventId,
  partId,
  scoreUnit,
  tieneCap,
  tieneDesempate,
  modo,
  inicial,
}: {
  eventId: string;
  partId: string;
  scoreUnit: ScoreUnitDb;
  tieneCap: boolean;
  tieneDesempate: boolean;
  modo: "cargar" | "corregir";
  inicial: FilaDeScore;
}) {
  const [status, setStatus] = useState<ScoreStatusDb>(inicial.status);
  const [valor, setValor] = useState(comoTexto(scoreUnit, inicial.value));
  const [reps, setReps] = useState(inicial.reps === null ? "" : String(inicial.reps));
  const [capValue, setCapValue] = useState(
    inicial.capValue === null ? "" : String(inicial.capValue),
  );
  const [desempate, setDesempate] = useState(comoTexto("tiempo", inicial.tiebreak));
  const [motivo, setMotivo] = useState("");
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [pendiente, startTransition] = useTransition();

  const esCorreccion = modo === "corregir";
  // En modo "corregir" no hay nada para editar hasta que el juez produzca un
  // primer resultado: esta funcion es para AJUSTAR, nunca para cargar de cero
  // una prueba en vivo (eso lo sigue prohibiendo corregir_workout_score()).
  const sinResultadoDelJuezTodavia = esCorreccion && inicial.source === null;

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
    if (esCorreccion) formData.set("motivo", motivo);

    setError(null);
    setGuardado(false);

    startTransition(async () => {
      const resultado = esCorreccion
        ? await corregirScore({ error: null }, formData)
        : await guardarScore({ error: null }, formData);
      if (resultado.error) setError(resultado.error);
      else {
        setGuardado(true);
        setCorrigiendo(false);
      }
    });
  }

  const cargaValor = status === "valido";
  const cargaCap = status === "capeado";
  // En "corregir", los campos empiezan bloqueados: hay que apretar "Corregir"
  // a proposito antes de poder tocar un resultado que ya es oficial.
  const bloqueadoPorConfirmar = esCorreccion && !corrigiendo;

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-baseline gap-3">
        <span className="font-mono tabular-nums text-neutral-400">#{inicial.bib}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{inicial.nombre}</span>
        <span className="text-xs text-neutral-500">{inicial.divisionName}</span>
      </div>

      {inicial.source && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span className="rounded-full border border-neutral-700 px-2 py-0.5">
            {ORIGEN_LABEL[inicial.source]}
          </span>
          {inicial.corregidoEn && (
            <span>
              Corregido el {fechaCorta(inicial.corregidoEn)}
              {inicial.corregidoPorNombre ? ` por ${inicial.corregidoPorNombre}` : ""}
            </span>
          )}
        </div>
      )}

      {sinResultadoDelJuezTodavia ? (
        <p className="text-sm text-neutral-500">Todavía no hay resultado del juez para corregir.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto] sm:items-end">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">Estado</span>
              <Selector
                value={status}
                onChange={(e) => setStatus(e.target.value as ScoreStatusDb)}
                disabled={bloqueadoPorConfirmar}
                className={selector}
              >
                {ESTADOS.filter((e) => e.value !== "capeado" || tieneCap).map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </Selector>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">
                {cargaCap ? "Repeticiones alcanzadas" : `Resultado (${UNIDAD_CORTA[scoreUnit]})`}
              </span>
              <input
                value={cargaCap ? capValue : valor}
                onChange={(e) =>
                  cargaCap ? setCapValue(e.target.value) : setValor(e.target.value)
                }
                disabled={bloqueadoPorConfirmar || (!cargaValor && !cargaCap)}
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
                  disabled={bloqueadoPorConfirmar || !cargaValor}
                  className={campo}
                />
              </label>
            ) : tieneDesempate ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-neutral-500">Desempate (mm:ss)</span>
                <input
                  value={desempate}
                  onChange={(e) => setDesempate(e.target.value)}
                  disabled={bloqueadoPorConfirmar}
                  className={campo}
                />
              </label>
            ) : (
              <span />
            )}

            {esCorreccion && !corrigiendo ? (
              <Boton variante="secondary" compacto onClick={() => setCorrigiendo(true)}>
                Corregir
              </Boton>
            ) : (
              <Boton
                variante="secondary"
                compacto
                onClick={guardar}
                cargando={pendiente}
                textoCargando="…"
                disabled={esCorreccion && !motivo.trim()}
              >
                {guardado ? "✓" : esCorreccion ? "Confirmar corrección" : "Guardar"}
              </Boton>
            )}
          </div>

          {esCorreccion && corrigiendo && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-500">
                Motivo de la corrección (obligatorio)
              </span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: impugnación revisada con el video, el conteo real fue distinto"
                className={campo}
              />
            </label>
          )}
        </>
      )}

      {error && <MensajeDeError compacto>{error}</MensajeDeError>}
    </li>
  );
}
