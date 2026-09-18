import { formatElapsed } from "@/shared/timing/clock";
import type { ResultadoDeAtleta } from "../queries";
import { DetalleDelAtleta } from "./DetalleDeAtleta";

/**
 * El resultado de UN atleta, ya resuelto (`getResultadoDeAtleta`), en su
 * formato: puntaje por WOD (CrossFit) o tiempo y parciales (circuito).
 *
 * PRESENTACIONAL PURO -- nace de `/en-vivo/[slug]/atleta/[bib]` (la pagina
 * publica), extraido para que `/panel/en-vivo/[slug]/atleta/[bib]` (la MISMA
 * vista, pero adentro del panel, sin perder la barra lateral ni el header)
 * lo reuse sin reimplementar como se arma un puntaje de WOD o un tiempo de
 * circuito por segunda vez. Cada pagina pone su propio "← volver" y su
 * propio contenedor: este componente es solo el contenido.
 */
export function ResultadoDelAtleta({
  resultado,
}: {
  resultado: Exclude<ResultadoDeAtleta, null>;
}) {
  if (resultado.format === "crossfit") {
    const { tabla, fila, official } = resultado;

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <p className="text-center text-xs tracking-wider text-neutral-600 uppercase">
          {official ? "Resultado oficial" : "Resultado no oficial · en vivo"}
        </p>
        <DetalleDelAtleta
          fila={fila}
          parts={tabla.partes}
          fieldSize={tabla.camposPorEtapa.get(fila.etapaVigente) ?? tabla.filas.length}
          division={tabla.division}
        />
      </div>
    );
  }

  const { row, rivales, official } = resultado;
  const enCarrera = row.status === "running";

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
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
          {official ? "Resultado oficial" : "Tiempo no oficial · en vivo"}
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
    </div>
  );
}
