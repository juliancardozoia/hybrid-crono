import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatElapsed } from "@/shared/timing/clock";
import { getEventInfo, getLeaderboard, getTablaGeneral } from "@/features/leaderboard/queries";
import { tablaDeDivision } from "@/features/leaderboard/lib/tabla";
import { DetalleDelAtleta } from "@/features/leaderboard/components/DetalleDeAtleta";

export const dynamic = "force-dynamic";

export default async function AtletaPage({
  params,
}: {
  params: Promise<{ slug: string; bib: string }>;
}) {
  const { slug, bib } = await params;
  const numero = Number(bib);

  // Cliente CON SESION, no el anonimo puro: un inscripto o un staff de ESTE
  // evento ven su propio resultado sin importar el plan ni si el evento ya se
  // publico -- el bypass vive en Postgres (`puede_ver_resultados_propios`, ver
  // supabase/migrations/20260921100000_resultados_propios_sin_gate.sql). Sin
  // sesion, se comporta exactamente como el cliente anonimo de siempre: un
  // visitante sin cuenta no gana nada. El leaderboard PUBLICO
  // (`/en-vivo/[slug]`) sigue usando el cliente anonimo puro a proposito --
  // ese si tiene que verse igual para cualquiera, sea quien sea.
  const supabase = await createClient();
  const info = await getEventInfo(slug, supabase);
  if (!info) notFound();

  // Un CrossFit puntua por WOD (tiempo, reps o puntos segun la prueba, en
  // varias etapas si hubo corte) -- otro dato, y otra forma de mostrarlo, que
  // el tiempo total de una carrera hibrida. `DetalleDelAtleta` ya arma
  // exactamente esa vista -- es la misma que despliega el organizador fila por
  // fila en /leaderboard -- asi que aca solo hace falta encontrar la fila de
  // ESTE dorsal y ponerla en la pantalla.
  if (info.format === "crossfit") {
    const datos = await getTablaGeneral(slug, supabase);
    const entradaDelEquipo = datos.divisiones.flatMap((d) => d.entries).find((e) => e.team.bib === numero);
    const tabla = entradaDelEquipo ? tablaDeDivision(datos, entradaDelEquipo.team.divisionId) : null;
    const fila = tabla?.filas.find((f) => f.teamId === entradaDelEquipo?.teamId);

    if (!tabla || !fila) {
      return <SinResultados slug={slug} bib={bib} eventName={info.name} />;
    }

    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5">
        <div>
          <Link href={`/en-vivo/${slug}`} className="text-sm text-neutral-500 hover:text-neutral-300">
            ← {info.name}
          </Link>
        </div>
        <p className="text-center text-xs tracking-wider text-neutral-600 uppercase">
          {datos.official ? "Resultado oficial" : "Resultado no oficial · en vivo"}
        </p>
        <DetalleDelAtleta
          fila={fila}
          parts={tabla.partes}
          fieldSize={tabla.camposPorEtapa.get(fila.etapaVigente) ?? tabla.filas.length}
          division={tabla.division}
        />
      </main>
    );
  }

  const leaderboard = await getLeaderboard(slug, supabase);
  const row = leaderboard.rows.find((r) => r.bib === numero);

  if (!row) {
    return <SinResultados slug={slug} bib={bib} eventName={info.name} />;
  }

  const enCarrera = row.status === "running";
  const rivales = leaderboard.rows.filter((r) => r.divisionName === row.divisionName);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-5">
      <div>
        <Link href={`/en-vivo/${slug}`} className="text-sm text-neutral-500 hover:text-neutral-300">
          ← {info.name}
        </Link>
      </div>

      <header className="text-center">
        <p className="font-mono text-sm text-neutral-500">#{row.bib}</p>
        <h1 className="mt-1 text-2xl font-bold">{row.athletes}</h1>
        <p className="text-sm text-neutral-500">{row.divisionName}</p>

        <p className="mt-6 font-mono text-5xl font-black tabular-nums">
          {row.status === "dnf"
            ? "DNF"
            : row.status === "dq"
              ? "DQ"
              : row.totalMs !== null
                ? formatElapsed(row.totalMs)
                : enCarrera
                  ? "en carrera"
                  : "—"}
        </p>

        {row.status === "finished" && (
          <p className="mt-2 text-lg">
            Puesto <strong className="text-lime-400">{row.position}</strong> de {rivales.length} en{" "}
            {row.divisionName}
          </p>
        )}

        {row.penaltyMs > 0 && (
          <p className="mt-2 text-sm text-amber-400">
            Incluye +{formatElapsed(row.penaltyMs, { centis: false })} de penalización
          </p>
        )}

        <p className="mt-4 text-xs tracking-wider text-neutral-600 uppercase">
          {leaderboard.official ? "Resultado oficial" : "Tiempo no oficial · en vivo"}
        </p>
      </header>

      {row.splits.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            Parciales
          </h2>
          <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
            {row.splits.map((split) => (
              <li
                key={`${split.orderIndex}-${split.segmentName}`}
                className="flex items-baseline justify-between px-4 py-3"
              >
                <span className="text-sm">
                  <span className="mr-2 font-mono text-neutral-600">
                    {String(split.orderIndex + 1).padStart(2, "0")}
                  </span>
                  {split.segmentName}
                </span>
                <span className="text-right">
                  <span className="block font-mono text-base tabular-nums">
                    {formatElapsed(split.durationMs)}
                  </span>
                  <span className="block font-mono text-xs text-neutral-500 tabular-nums">
                    {formatElapsed(split.cumulativeMs)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function SinResultados({ slug, bib, eventName }: { slug: string; bib: string; eventName: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold">Sin resultados todavía</p>
      <p className="text-sm text-neutral-500">
        El dorsal {bib} aún no tiene tiempos cargados en {eventName}.
      </p>
      <Link href={`/en-vivo/${slug}`} className="text-sm text-lime-400 hover:underline">
        Ver todos los resultados
      </Link>
    </main>
  );
}
