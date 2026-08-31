"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import { getLeaderboard, type Leaderboard, type LeaderboardRow } from "../queries";

/**
 * Leaderboard en vivo.
 *
 * Refresca por polling y no por Realtime a proposito: el rol anonimo no tiene
 * permisos sobre ninguna tabla, y postgres_changes exige SELECT para poder
 * suscribirse. Abrirle `results` al publico solo para ganar unos segundos seria
 * cambiar superficie de seguridad por una latencia que a nadie le importa: un
 * atleta cruza la meta cada varios minutos, no cada 200 milisegundos.
 */
const REFRESCO_MS = 8_000;

export function LeaderboardLive({
  slug,
  inicial,
  eventName,
}: {
  slug: string;
  inicial: Leaderboard;
  eventName: string;
}) {
  const [data, setData] = useState(inicial);
  const [division, setDivision] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelado) return;
      try {
        const fresco = await getLeaderboard(slug);
        if (!cancelado && fresco.rows.length > 0) setData(fresco);
      } catch {
        // Sin red: se sigue mostrando lo ultimo que llego.
      }
      if (!cancelado) timer = setTimeout(poll, REFRESCO_MS);
    };

    timer = setTimeout(poll, REFRESCO_MS);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [slug]);

  const divisionActiva = division ?? data.divisions[0] ?? null;
  const filas = data.rows.filter((r) => r.divisionName === divisionActiva);

  return (
    <main className="mx-auto w-full max-w-3xl p-5">
      <header className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{eventName}</h1>
          <EstadoOficial official={data.official} />
        </div>
        <Link
          href={`/en-vivo/${slug}/proyector`}
          className="mt-2 inline-block text-sm text-neutral-500 hover:text-neutral-300"
        >
          Ver en pantalla grande →
        </Link>
      </header>

      {data.rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-8 text-center text-neutral-500">
          Todavía no hay resultados. Aparecen a medida que los atletas van terminando.
        </p>
      ) : (
        <>
          {data.divisions.length > 1 && (
            <nav className="tabs-scroll mb-4 flex gap-1 border-b border-neutral-800">
              {data.divisions.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDivision(d)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
                    d === divisionActiva
                      ? "border-lime-400 font-medium text-neutral-100"
                      : "border-transparent text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {d}
                </button>
              ))}
            </nav>
          )}

          <ul className="flex flex-col gap-1.5">
            {filas.map((row) => (
              <li key={`${row.divisionName}-${row.bib}`}>
                <Link
                  href={`/en-vivo/${slug}/atleta/${row.bib}`}
                  className="flex items-center gap-3 rounded-xl border border-neutral-800 px-4 py-3 transition-colors hover:border-neutral-700"
                >
                  <Posicion row={row} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{row.athletes}</span>
                    <span className="block text-xs text-neutral-500">
                      #{row.bib}
                      {row.teamName && ` · ${row.teamName}`}
                      {row.penaltyMs > 0 &&
                        ` · +${formatElapsed(row.penaltyMs, { centis: false })} penal.`}
                    </span>
                  </span>
                  <Tiempo row={row} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function EstadoOficial({ official }: { official: boolean }) {
  return official ? (
    <span className="rounded-lg bg-emerald-500/15 px-3 py-1 text-xs font-bold tracking-wider text-emerald-300 uppercase">
      Resultados oficiales
    </span>
  ) : (
    <span className="rounded-lg bg-amber-500/15 px-3 py-1 text-xs font-bold tracking-wider text-amber-300 uppercase">
      No oficial · en vivo
    </span>
  );
}

function Posicion({ row }: { row: LeaderboardRow }) {
  if (row.status !== "finished") {
    return <span className="w-8 text-center text-xs text-neutral-600">—</span>;
  }

  const medalla = ["text-amber-300", "text-neutral-300", "text-orange-400"][row.position - 1];
  return (
    <span className={`w-8 text-center font-mono text-xl font-bold ${medalla ?? "text-neutral-500"}`}>
      {row.position}
    </span>
  );
}

function Tiempo({ row }: { row: LeaderboardRow }) {
  if (row.status === "dnf") return <span className="text-sm text-neutral-500">DNF</span>;
  if (row.status === "dq") return <span className="text-sm text-red-400">DQ</span>;
  if (row.status === "running") {
    return <span className="text-sm text-lime-400">en carrera</span>;
  }
  if (row.totalMs === null) return <span className="text-sm text-neutral-600">—</span>;

  return (
    <span className="font-mono text-lg font-bold tabular-nums">{formatElapsed(row.totalMs)}</span>
  );
}
