"use client";

import { useState } from "react";
import { Selector } from "@/shared/components/Selector";
import type { Inscritos } from "../queries";

/**
 * La lista de largada, con la MISMA grilla que el leaderboard.
 *
 * POS · ATLETA/EQUIPO · PTS, y en la columna de la derecha "Sin datos de
 * rendimiento". No es una lista distinta que despues se reemplaza por la tabla:
 * es la MISMA tabla antes de que haya con que llenarla. Quien la mira dos meses
 * antes y el dia de la competencia ve la misma estructura, y lo unico que cambia
 * son los numeros.
 *
 * TODOS EN LA POSICION 1, y no numerados del 1 al 40. Con cero puntos estan
 * literalmente empatados, y el proyecto ya usa posiciones FISICAS —competidores
 * por delante mas uno— en todo el motor de puntuacion. Numerarlos por orden de
 * inscripcion inventaria un ranking que no existe, y el primero de la lista
 * creeria que va ganando.
 *
 * QUE SIGNIFICA "PTS" DEPENDE DEL FORMATO: en un CrossFit son los puntos de la
 * tabla; en una carrera hibrida, el tiempo. Antes de arrancar no hay ninguno de
 * los dos, asi que la columna va en cero y el texto de la derecha explica por
 * que.
 */
export function ListaDeLargada({ datos }: { datos: Inscritos }) {
  const conEquipos = datos.divisiones.filter((d) => d.equipos.length > 0);
  const [elegida, setElegida] = useState(conEquipos[0]?.nombre ?? "");

  if (conEquipos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-800 p-12 text-center">
        <p className="font-medium text-neutral-300">Todavía no hay inscritos</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-500">
          Aquí aparece la lista de largada a medida que se confirman las inscripciones.
        </p>
      </div>
    );
  }

  const division = conEquipos.find((d) => d.nombre === elegida) ?? conEquipos[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight uppercase">Leaderboard</h2>
        <span className="text-sm text-neutral-500">
          {division.equipos.length}{" "}
          {division.equipos.length === 1 ? "inscrito" : "inscritos"} en esta categoría
        </span>
      </div>

      {conEquipos.length > 1 && (
        <label className="flex max-w-sm flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
            Categoría
          </span>
          <Selector
            value={division.nombre}
            onChange={(e) => setElegida(e.target.value)}
            className="w-full py-3"
          >
            {conEquipos.map((d) => (
              <option key={d.nombre} value={d.nombre}>
                {d.nombre} ({d.equipos.length})
              </option>
            ))}
          </Selector>
        </label>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-neutral-800 text-xs tracking-wider text-neutral-500 uppercase">
              <th scope="col" className="w-14 py-3 pr-3 font-medium">
                Pos
              </th>
              <th scope="col" className="py-3 pr-4 font-medium">
                Atleta / Equipo
              </th>
              <th scope="col" className="w-20 py-3 pr-4 font-medium">
                Pts
              </th>
              <th scope="col" className="py-3 font-medium">
                <span className="sr-only">Estado</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {division.equipos.map((eq) => (
              <tr key={eq.dorsal} className="border-b border-neutral-900">
                <td className="py-3.5 pr-3 font-mono text-lg font-bold tabular-nums text-neutral-400">
                  1
                </td>
                <td className="py-3.5 pr-4">
                  <p className="font-semibold">{eq.nombre}</p>
                  {/* Los integrantes solo cuando el nombre del equipo no los
                      dice. En individuales el nombre YA es el del atleta y
                      repetirlo debajo se lee como un error. */}
                  {eq.integrantes.length > 1 ? (
                    <p className="text-sm text-neutral-500">{eq.integrantes.join(" · ")}</p>
                  ) : (
                    <p className="text-sm text-neutral-600">Dorsal {eq.dorsal}</p>
                  )}
                </td>
                <td className="py-3.5 pr-4 font-mono tabular-nums text-neutral-400">0</td>
                <td className="py-3.5 text-sm text-neutral-600">Sin datos de rendimiento</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-neutral-600">
        La lista se actualiza a medida que se confirman las inscripciones. Los puntos aparecen aquí
        mismo cuando arranque la competencia.
      </p>
    </div>
  );
}
