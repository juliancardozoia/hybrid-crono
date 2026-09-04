"use client";

import { useActionState, useState } from "react";
import { crearPrueba, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { Selector } from "@/shared/components/Selector";
import type { ScoreDirDb, ScoreUnitDb, TimeScheme } from "@/lib/supabase/types";

/**
 * Alta de una prueba.
 *
 * Los campos cambian segun el esquema de tiempo, asi que es un componente de
 * cliente. El formulario SI puede ser un <form action>: al crear una prueba
 * queremos que se limpie, que es justo lo que hace React 19 al terminar la
 * accion. El caso en que ese reset molesta —y hay que invocar la accion a
 * mano— es la grilla de carga de scores, que tiene que conservar lo recien
 * guardado.
 */

interface Preset {
  id: string;
  etiqueta: string;
  descripcion: string;
  name: string;
  timeScheme: TimeScheme;
  scoreUnit: ScoreUnitDb;
  scoreDir: ScoreDirDb;
  capMinutos?: string;
  ventanaMinutos?: string;
  intervaloSegundos?: string;
}

/**
 * Los formatos que aparecen en casi toda competencia. Existen por la misma
 * razon que el preset de Hyrox en la pantalla de circuito: cargar todo a mano
 * es donde el organizador abandona la configuracion.
 */
const PRESETS: Preset[] = [
  {
    id: "for_time",
    etiqueta: "For Time con cap",
    descripcion:
      "Terminar lo antes posible. Quien no termina rankea por repeticiones.",
    name: "",
    timeScheme: "cap",
    scoreUnit: "tiempo",
    scoreDir: "menor_gana",
    capMinutos: "12",
  },
  {
    id: "amrap",
    etiqueta: "AMRAP",
    descripcion: "Máximo de rondas y repeticiones en una ventana fija.",
    name: "",
    timeScheme: "ventana",
    scoreUnit: "rondas_reps",
    scoreDir: "mayor_gana",
    ventanaMinutos: "20",
  },
  {
    id: "emom",
    etiqueta: "EMOM / Tabata",
    descripcion:
      "Trabajo por intervalo. La pantalla del juez avanza con el reloj.",
    name: "",
    timeScheme: "intervalos",
    scoreUnit: "reps",
    scoreDir: "mayor_gana",
    intervaloSegundos: "60",
  },
  {
    id: "carga",
    etiqueta: "Carga máxima",
    descripcion: "Intentos de levantamiento. Gana el mayor kilaje válido.",
    name: "",
    timeScheme: "sin_reloj",
    scoreUnit: "carga",
    scoreDir: "mayor_gana",
  },
];

const ESQUEMAS: Array<{ value: TimeScheme; label: string }> = [
  { value: "cap", label: "For Time con cap" },
  { value: "libre", label: "For Time sin cap" },
  { value: "ventana", label: "AMRAP (ventana fija)" },
  { value: "intervalos", label: "Intervalos (EMOM, Tabata)" },
  { value: "sin_reloj", label: "Carga máxima (sin reloj)" },
];

const UNIDADES: Array<{ value: ScoreUnitDb; label: string }> = [
  { value: "tiempo", label: "Tiempo" },
  { value: "reps", label: "Repeticiones" },
  { value: "rondas", label: "Rondas" },
  { value: "rondas_reps", label: "Rondas + repeticiones" },
  { value: "carga", label: "Kilos" },
  { value: "distancia", label: "Metros" },
  { value: "calorias", label: "Calorías" },
  { value: "puntos", label: "Puntos" },
];

const campo =
  "rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400";
const selector = "w-full py-3";

export function NuevaPrueba({ eventId }: { eventId: string }) {
  const [state, formAction] = useActionState(crearPrueba, {
    error: null,
  } as FormState);
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);

  function aplicar(id: string) {
    const elegido = PRESETS.find((p) => p.id === id);
    if (elegido) setPreset(elegido);
  }

  return (
    <section className="rounded-2xl border border-neutral-800 p-5">
      <h3 className="font-semibold">Nueva prueba</h3>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => aplicar(p.id)}
            className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
              preset.id === p.id
                ? "border-lime-400 text-lime-300"
                : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-neutral-500">{preset.descripcion}</p>

      {/* La key fuerza a React a remontar los campos cuando cambia el preset:
          sin eso, los defaultValue no se vuelven a aplicar. */}
      <form
        key={preset.id}
        action={formAction}
        className="mt-4 flex flex-col gap-4"
      >
        <input type="hidden" name="eventId" value={eventId} />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Nombre</span>
          <input
            name="name"
            required
            placeholder="Evento 1"
            className={campo}
            defaultValue={preset.name}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Formato</span>
            <Selector
              name="timeScheme"
              defaultValue={preset.timeScheme}
              className={selector}
            >
              {ESQUEMAS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Selector>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Qué mide</span>
            <Selector
              name="scoreUnit"
              defaultValue={preset.scoreUnit}
              className={selector}
            >
              {UNIDADES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Selector>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Quién gana</span>
            <Selector
              name="scoreDir"
              defaultValue={preset.scoreDir}
              className={selector}
            >
              <option value="menor_gana">El menor valor</option>
              <option value="mayor_gana">El mayor valor</option>
            </Selector>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Formato de equipo</span>
            <Selector
              name="teamMode"
              defaultValue="individual"
              className={selector}
            >
              <option value="individual">Individual</option>
              <option value="sincronizado">Sincronizado</option>
              <option value="alternado">
                Alternado (uno trabaja, uno descansa)
              </option>
              <option value="relevo">Relevo</option>
              <option value="reparto_libre">Reparto libre</option>
            </Selector>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Cap (min)</span>
            <input
              name="capMinutos"
              type="number"
              min="1"
              step="0.5"
              className={campo}
              defaultValue={preset.capMinutos ?? ""}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Ventana (min)</span>
            <input
              name="ventanaMinutos"
              type="number"
              min="1"
              step="0.5"
              className={campo}
              defaultValue={preset.ventanaMinutos ?? ""}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Intervalo (seg)</span>
            <input
              name="intervaloSegundos"
              type="number"
              min="5"
              className={campo}
              defaultValue={preset.intervaloSegundos ?? ""}
            />
          </label>
        </div>

        {state.error && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {state.error}
          </p>
        )}

        <p className="text-sm text-neutral-500">
          Se asigna a todas las categorías del evento. Después puedes sacar las
          que no la corran.
        </p>

        <div>
          <BotonDeEnvio
            pendienteTexto="Creando…"
            mensajeDeCarga="Creando la prueba…"
            className="rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
          >
            Crear prueba
          </BotonDeEnvio>
        </div>
      </form>
    </section>
  );
}
