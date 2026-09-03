"use client";

import { useActionState, useState } from "react";
import { agregarMovimiento, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";

/**
 * Alta de un movimiento dentro de un bloque.
 *
 * Es de cliente por dos razones: el campo "Otro" solo aparece cuando el
 * movimiento no esta en el catalogo, y la unidad se preselecciona segun lo que
 * mide el movimiento elegido (un Row va en metros, un Thruster en reps).
 */

export interface OpcionDeMovimiento {
  id: string;
  name: string;
  category: string;
  defaultUnit: string;
  allowsLoad: boolean;
}

const CATEGORIA: Record<string, string> = {
  levantamiento: "Levantamiento",
  gimnastico: "Gimnásticos",
  monoestructural: "Cardio",
  odd_object: "Objetos y acarreos",
  otro: "Otros",
};

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400";
const selector =
  "w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-lime-400";

export function NuevoMovimiento({
  eventId,
  partId,
  blockId,
  catalogo,
}: {
  eventId: string;
  partId: string;
  blockId: string;
  catalogo: OpcionDeMovimiento[];
}) {
  const [state, formAction] = useActionState(agregarMovimiento, {
    error: null,
  } as FormState);
  const [movementId, setMovementId] = useState("");
  const [unit, setUnit] = useState("reps");
  const [maxReps, setMaxReps] = useState(false);

  const elegido = catalogo.find((m) => m.id === movementId);
  const esOtro = movementId === "otro";

  const porCategoria = new Map<string, OpcionDeMovimiento[]>();
  for (const m of catalogo) {
    const lista = porCategoria.get(m.category) ?? [];
    lista.push(m);
    porCategoria.set(m.category, lista);
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="partId" value={partId} />
      <input type="hidden" name="blockId" value={blockId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Movimiento</span>
          <select
            name="movementId"
            value={movementId}
            onChange={(e) => {
              setMovementId(e.target.value);
              const m = catalogo.find((c) => c.id === e.target.value);
              if (m) setUnit(m.defaultUnit);
            }}
            className={selector}
          >
            <option value="">Elegir…</option>
            {[...porCategoria.entries()].map(([categoria, lista]) => (
              <optgroup
                key={categoria}
                label={CATEGORIA[categoria] ?? categoria}
              >
                {lista.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
            {/* El escape para lo que el catalogo no tiene. La plataforma ve
                estos nombres para promoverlos despues. */}
            <option value="otro">Otro (escribirlo)</option>
          </select>
        </label>

        {esOtro ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">
              Nombre del movimiento
            </span>
            <input
              name="customName"
              className={campo}
              placeholder="Subida de cuerda con chaleco"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-400">Unidad</span>
            <select
              name="unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className={selector}
            >
              <option value="reps">Repeticiones</option>
              <option value="metros">Metros</option>
              <option value="calorias">Calorías</option>
              <option value="segundos">Segundos</option>
              <option value="kg">Kilos</option>
            </select>
          </label>
        )}
      </div>

      {esOtro && <input type="hidden" name="unit" value={unit} />}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Objetivo por ronda</span>
          <input
            name="objetivo"
            className={campo}
            placeholder="21-15-9 o 50"
            disabled={maxReps}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-400">Carga (kg)</span>
          <input
            name="loadKg"
            type="number"
            step="0.5"
            min="0"
            className={campo}
            disabled={elegido ? !elegido.allowsLoad : false}
            placeholder={elegido && !elegido.allowsLoad ? "sin carga" : ""}
          />
        </label>

        <div className="flex flex-col justify-end gap-2 pb-1">
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              name="maxReps"
              checked={maxReps}
              onChange={(e) => setMaxReps(e.target.checked)}
              className="accent-lime-400"
            />
            Las que pueda en el tiempo restante
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              name="esTiebreak"
              className="accent-lime-400"
            />
            Marca el desempate
          </label>
        </div>
      </div>

      {state.error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div>
        <BotonDeEnvio
          pendienteTexto="Agregando…"
          mensajeDeCarga="Agregando el movimiento…"
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900 disabled:opacity-60"
        >
          Agregar movimiento
        </BotonDeEnvio>
      </div>
    </form>
  );
}
