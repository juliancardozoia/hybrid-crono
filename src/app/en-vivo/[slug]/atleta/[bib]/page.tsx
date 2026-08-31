import Link from "next/link";
import { notFound } from "next/navigation";
import { formatElapsed } from "@/shared/timing/clock";
import { getEventInfo, getLeaderboard } from "@/features/leaderboard/queries";

export const dynamic = "force-dynamic";

export default async function AtletaPage({
  params,
}: {
  params: Promise<{ slug: string; bib: string }>;
}) {
  const { slug, bib } = await params;
  const [info, leaderboard] = await Promise.all([getEventInfo(slug), getLeaderboard(slug)]);

  if (!info) notFound();

  const numero = Number(bib);
  const row = leaderboard.rows.find((r) => r.bib === numero);

  if (!row) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-semibold">Sin resultados todavía</p>
        <p className="text-sm text-neutral-500">
          El dorsal {bib} aún no tiene tiempos cargados en {info.name}.
        </p>
        <Link href={`/en-vivo/${slug}`} className="text-sm text-lime-400 hover:underline">
          Ver todos los resultados
        </Link>
      </main>
    );
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
