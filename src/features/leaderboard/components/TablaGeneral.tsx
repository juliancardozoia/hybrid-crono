"use client";

import { useEffect, useState } from "react";
import { getTablaGeneral, type TablaGeneral as Datos } from "../queries";

/**
 * Tabla general por puntos.
 *
 * Solo aparece cuando el evento tiene mas de una prueba. Con una sola —el caso
 * de una carrera hibrida— el general y el ranking de esa prueba son lo mismo, y
 * mostrar dos tablas identicas confunde en vez de informar.
 *
 * Refresca por polling, igual que el resto de las pantallas publicas y por la
 * misma razon: el rol anonimo no tiene permisos sobre ninguna tabla y
 * postgres_changes exige SELECT para suscribirse.
 */
const REFRESCO_MS = 8_000;

export function TablaGeneral({ slug, inicial }: { slug: string; inicial: Datos }) {
  const [data, setData] = useState(inicial);
  const [division, setDivision] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelado) return;
      try {
        const fresco = await getTablaGeneral(slug);
        // No se vacia la pantalla si una consulta falla: se sigue mostrando lo
        // ultimo que llego.
        if (!cancelado && fresco.divisiones.length > 0) setData(fresco);
      } catch {
        // Sin red.
      }
      if (!cancelado) timer = setTimeout(poll, REFRESCO_MS);
    };

    timer = setTimeout(poll, REFRESCO_MS);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [slug]);

  if (data.cantidadDePruebas <= 1 || data.divisiones.length === 0) return null;

  const elegida = data.divisiones.find((d) => d.division.id === division) ?? data.divisiones[0];

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Tabla general</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            data.official
              ? "bg-lime-400/15 text-lime-300"
              : "bg-amber-400/15 text-amber-300"
          }`}
        >
          {data.official ? "OFICIAL" : "NO OFICIAL"}
        </span>
      </div>

      {data.divisiones.length > 1 && (
        <nav className="tabs-scroll mt-4 flex gap-1 border-b border-neutral-800">
          {data.divisiones.map((d) => {
            const activa = d.division.id === elegida.division.id;
            return (
              <button
                key={d.division.id}
                type="button"
                onClick={() => setDivision(d.division.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  activa
                    ? "border-lime-400 font-medium text-neutral-100"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {d.division.name}
              </button>
            );
          })}
        </nav>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <th className="py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Atleta</th>
              <th className="py-2 pr-3 text-right font-medium">Pts</th>
              {elegida.parts.map((p) => (
                <th key={p.id} className="py-2 pr-3 text-right font-medium whitespace-nowrap">
                  {p.workoutName}
                  {p.label && ` ${p.label}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {elegida.entries.map((fila) => (
              <tr key={fila.teamId} className="border-b border-neutral-900">
                <td className="py-2 pr-3 font-mono tabular-nums text-neutral-400">
                  {fila.position}
                  {/* Compartir posicion no es un error: el reglamento no rompe
                      los empates de la tabla general si los puestos por prueba
                      tambien empatan. */}
                  {fila.tiedWith > 1 && <span className="text-neutral-600">=</span>}
                </td>
                <td className="py-2 pr-3">
                  <span className="font-mono text-neutral-500">#{fila.team.bib}</span>{" "}
                  {fila.team.name ?? fila.team.athletes ?? ""}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums font-semibold">
                  {fila.totalPoints}
                </td>
                {elegida.parts.map((p) => {
                  const puesto = fila.placements.find((x) => x.partId === p.id);
                  return (
                    <td
                      key={p.id}
                      className="py-2 pr-3 text-right font-mono tabular-nums text-neutral-400"
                    >
                      {puesto ? `${puesto.position}º` : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
