"use client";

import { useActionState, useState } from "react";
import { empezarInscripcion, type FormState } from "../actions";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { CategoriaParaInscribirse } from "../queries";

/**
 * El primer paso de la inscripcion: elegir categoria.
 *
 * Es lo primero que se pide porque todo lo demas depende de eso — si hace falta
 * nombre de equipo, cuantos integrantes, cuanto sale y que campos se preguntan.
 * Un formulario que pide los datos antes de saber la categoria tiene que
 * adivinar, y adivina mal.
 */

const SEXO: Record<string, string> = {
  male: "Masculino",
  female: "Femenino",
  mixed: "Mixta",
  any: "Abierta",
};

function precio(cents: number | null, moneda: string): string {
  if (cents === null || cents === 0) return "Sin costo";
  // Sin decimales: los pesos de la region no los usan en un precio de
  // inscripcion, y "150.000" se lee mejor que "150.000,00".
  return `${new Intl.NumberFormat("es", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(cents / 100)}`;
}

export function ElegirCategoria({
  categorias,
}: {
  categorias: CategoriaParaInscribirse[];
}) {
  const [state, formAction] = useActionState(empezarInscripcion, {
    error: null,
  } as FormState);
  const [elegida, setElegida] = useState<string>("");

  const categoria = categorias.find((c) => c.id === elegida) ?? null;
  const esEquipo = (categoria?.teamSize ?? 1) > 1;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <ul className="flex flex-col gap-2">
        {categorias.map((c) => {
          const sinCupo =
            c.cuposDisponibles !== null && c.cuposDisponibles <= 0;
          const seleccionada = c.id === elegida;

          return (
            <li key={c.id}>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                  seleccionada
                    ? "border-lime-400 bg-lime-400/5"
                    : "border-neutral-800"
                } ${sinCupo ? "cursor-not-allowed opacity-50" : "hover:border-neutral-700"}`}
              >
                <input
                  type="radio"
                  name="divisionId"
                  value={c.id}
                  disabled={sinCupo}
                  checked={seleccionada}
                  onChange={() => setElegida(c.id)}
                  className="mt-1 accent-lime-400"
                />
                <span className="flex-1">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-sm text-neutral-500">
                    {c.teamSize === 1
                      ? "Individual"
                      : `Equipos de ${c.teamSize}`}{" "}
                    · {SEXO[c.genderRule] ?? c.genderRule}
                    {(c.ageMin || c.ageMax) &&
                      ` · ${c.ageMin ?? "?"}–${c.ageMax ?? "?"} años`}
                    {c.level && ` · ${c.level}`}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-semibold">
                      {precio(c.priceCents, c.currency)}
                    </span>
                    {c.cuposDisponibles !== null && (
                      <span
                        className={
                          sinCupo ? "text-neutral-600" : "text-neutral-400"
                        }
                      >
                        {sinCupo ? "Sin cupos" : `${c.cuposDisponibles} cupos`}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {esEquipo && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Nombre del equipo</span>
          <input
            name="teamName"
            required
            placeholder="Los Fuertes"
            className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400"
          />
          <span className="text-xs text-neutral-500">
            Después vas a poder invitar a {categoria!.teamSize - 1}{" "}
            {categoria!.teamSize === 2 ? "compañero" : "compañeros"} con su
            correo.
          </span>
        </label>
      )}

      {state.error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div>
        <BotonDeEnvio
          pendienteTexto="Creando…"
          mensajeDeCarga="Empezando la inscripción…"
          disabled={!elegida}
          className="rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
        >
          Continuar
        </BotonDeEnvio>
      </div>
    </form>
  );
}
