"use client";

import { useEffect, useState } from "react";
import { elapsedParts } from "@/shared/timing/clock";
import { getLeaderboard, type Leaderboard, type LeaderboardRow } from "../queries";

const REFRESCO_MS = 8_000;
/** Cuanto se queda cada division en pantalla antes de pasar a la siguiente. */
const ROTACION_MS = 15_000;
/** Cuantas filas entran comodas en una pantalla de venue. */
const FILAS_POR_PANTALLA = 10;

/**
 * Vista de proyector.
 *
 * Pensada para verse a diez metros: tipografia enorme, alto contraste y cero
 * interaccion. Rota sola entre divisiones y pagina los rankings largos, porque
 * nadie va a estar al lado del proyector apretando botones.
 */
export function Proyector({
  slug,
  inicial,
  eventName,
}: {
  slug: string;
  inicial: Leaderboard;
  eventName: string;
}) {
  const [data, setData] = useState(inicial);
  const [paso, setPaso] = useState(0);

  useEffect(() => {
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelado) return;
      try {
        const fresco = await getLeaderboard(slug);
        if (!cancelado && fresco.rows.length > 0) setData(fresco);
      } catch {
        // Sin red: sigue mostrando lo ultimo bueno en vez de vaciar la pantalla.
      }
      if (!cancelado) timer = setTimeout(poll, REFRESCO_MS);
    };

    timer = setTimeout(poll, REFRESCO_MS);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [slug]);

  // Cada "paso" es una pantalla: una division puede ocupar varias si tiene
  // muchos atletas.
  const pantallas = data.divisions.flatMap((division) => {
    const filas = data.rows.filter((r) => r.divisionName === division);
    const paginas = Math.max(1, Math.ceil(filas.length / FILAS_POR_PANTALLA));
    return Array.from({ length: paginas }, (_, i) => ({
      division,
      pagina: i + 1,
      totalPaginas: paginas,
      filas: filas.slice(i * FILAS_POR_PANTALLA, (i + 1) * FILAS_POR_PANTALLA),
    }));
  });

  useEffect(() => {
    if (pantallas.length <= 1) return;
    const timer = setInterval(() => setPaso((p) => p + 1), ROTACION_MS);
    return () => clearInterval(timer);
  }, [pantallas.length]);

  if (pantallas.length === 0) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-black text-neutral-500">
        <h1 className="text-5xl font-black text-neutral-300">{eventName}</h1>
        <p className="mt-6 text-2xl">Esperando los primeros resultados…</p>
      </main>
    );
  }

  const actual = pantallas[paso % pantallas.length];

  return (
    <main className="flex min-h-dvh flex-col bg-black px-8 py-6 text-neutral-50">
      <header className="flex items-baseline justify-between border-b-2 border-neutral-800 pb-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{eventName}</h1>
          <p className="mt-1 text-4xl font-bold text-lime-400">{actual.division}</p>
        </div>
        <div className="text-right">
          {data.official ? (
            <span className="text-2xl font-black tracking-wider text-emerald-400 uppercase">
              Oficial
            </span>
          ) : (
            <span className="text-2xl font-black tracking-wider text-amber-400 uppercase">
              No oficial
            </span>
          )}
          {actual.totalPaginas > 1 && (
            <p className="mt-1 text-lg text-neutral-500">
              {actual.pagina} / {actual.totalPaginas}
            </p>
          )}
        </div>
      </header>

      <ul className="flex flex-1 flex-col justify-center gap-2 py-4">
        {actual.filas.map((row) => (
          <li
            key={row.bib}
            className="flex items-center gap-6 border-b border-neutral-900 py-3 last:border-0"
          >
            <span
              className={`w-16 text-right font-mono text-5xl font-black tabular-nums ${
                row.status === "finished" && row.position <= 3 ? "text-lime-400" : "text-neutral-600"
              }`}
            >
              {row.status === "finished" ? row.position : "—"}
            </span>
            <span className="w-24 font-mono text-3xl text-neutral-500 tabular-nums">
              {row.bib}
            </span>
            <span className="min-w-0 flex-1 truncate text-4xl font-bold">{row.athletes}</span>
            <TiempoProyector row={row} />
          </li>
        ))}
      </ul>
    </main>
  );
}

/**
 * El tiempo en la pantalla del venue.
 *
 * Muestra SIEMPRE la precision completa —horas cuando aplica, y centesimas— porque
 * en una competencia por tiempo las centesimas deciden podios y el proyector es
 * donde el atleta y el publico leen el resultado.
 *
 * Las centesimas van mas chicas y en gris: siguen ahi para quien las busca, pero
 * no compiten con el resto del numero cuando alguien lee la tabla de lejos.
 */
function TiempoProyector({ row }: { row: LeaderboardRow }) {
  if (row.status === "dnf") {
    return <span className="font-mono text-4xl font-black text-neutral-600">DNF</span>;
  }
  if (row.status === "dq") {
    return <span className="font-mono text-4xl font-black text-red-500">DQ</span>;
  }
  if (row.status === "running") {
    return <span className="font-mono text-4xl font-black text-lime-400">EN CARRERA</span>;
  }
  if (row.totalMs === null) {
    return <span className="font-mono text-5xl font-black text-neutral-700">—</span>;
  }

  const { main, centis } = elapsedParts(row.totalMs);

  return (
    <span className="font-mono font-black tabular-nums">
      <span className="text-5xl">{main}</span>
      <span className="text-3xl text-neutral-400">.{centis}</span>
    </span>
  );
}
