import Link from "next/link";
import { formatElapsed } from "@/shared/timing/clock";
import { DetalleDelAtleta } from "@/features/leaderboard/components/DetalleDeAtleta";
import { LeaderboardLive } from "@/features/leaderboard/components/LeaderboardLive";
import type { Leaderboard, ResultadoDeAtleta } from "@/features/leaderboard/queries";
import { EstadoBadge } from "@/features/events/components/EstadoBadge";
import { rangoDeFechas, diasHasta } from "@/features/catalogo/lib/formato";
import type { Idioma } from "@/shared/i18n/idiomas";
import { claseDePastilla, textoDeEstado, mensajeDeReadiness } from "../lib/estados";
import { ordenarParaElListado, yaPaso } from "../lib/panorama";
import type { ResumenDeInscripcion } from "../queries";

/**
 * El panorama del atleta: mismo concepto que `PanoramaDeCompetencia` (el del
 * organizador) pero del otro lado del mostrador. Reemplaza a la seccion
 * "Compito" de antes -- una lista plana sin mas informacion que el estado del
 * tramite -- por un widget destacado (la competencia mas urgente: en vivo, o
 * la proxima por fecha) con su leaderboard y sus resultados si ya los hay, y
 * debajo la lista completa de todas las inscripciones.
 *
 * SOLO LA DESTACADA TIENE WIDGETS RICOS. Si el atleta corre dos competencias
 * a la vez, la segunda aparece igual en "Mis competencias" con su estado y un
 * link a su propia ficha -- no se duplica una fila entera de widgets por
 * cada inscripcion activa, que llenaria la pantalla de tarjetas.
 */
export function PanoramaDeAtleta({
  inscripciones,
  destacada,
  resultado,
  leaderboardCircuito,
  idioma,
}: {
  inscripciones: ResumenDeInscripcion[];
  destacada: ResumenDeInscripcion | null;
  /** Solo tiene sentido para `destacada`. `null` si todavia no hay nada que mostrar. */
  resultado: ResultadoDeAtleta;
  /** Solo si `destacada.eventFormat === "circuito"` y hay resultados. */
  leaderboardCircuito: Leaderboard | null;
  idioma: Idioma;
}) {
  if (!destacada) {
    return (
      <div className="rounded-2xl border border-dashed border-neutral-800 p-10 text-center">
        <p className="text-neutral-400">Todavía no te inscribiste en ninguna.</p>
      </div>
    );
  }

  // Los mismos estados que expone `public_event_info()`: fuera de estos, el
  // leaderboard publico ni siquiera tiene nada que devolver.
  const puedeTenerResultados = ["live", "verifying", "published"].includes(destacada.eventStatus);

  return (
    <div className="flex flex-col gap-6">
      <WidgetDestacada destacada={destacada} idioma={idioma} />

      {puedeTenerResultados &&
        (resultado?.format === "circuito" && leaderboardCircuito ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <WidgetLeaderboardDeCategoria
              slug={destacada.eventSlug}
              eventName={destacada.eventName}
              categoria={destacada.divisionName}
              leaderboard={leaderboardCircuito}
            />
            <WidgetMisResultadosCircuito resultado={resultado} />
          </div>
        ) : resultado?.format === "crossfit" ? (
          <WidgetMisResultadosCrossfit resultado={resultado} eventSlug={destacada.eventSlug} />
        ) : (
          <div className="rounded-2xl border border-dashed border-neutral-800 p-5 text-center text-sm text-neutral-500">
            Todavía no hay resultados cargados para vos en {destacada.eventName}.
          </div>
        ))}

      <WidgetMisCompetencias inscripciones={inscripciones} idioma={idioma} />
    </div>
  );
}

function mensajeDeCuentaRegresiva(i: ResumenDeInscripcion): string {
  if (i.eventStatus === "live") return "Está corriendo ahora.";
  if (i.eventStatus === "verifying") return "Terminó — están revisando los resultados.";
  if (i.eventStatus === "published") return "Resultados oficiales publicados.";

  const dias = diasHasta(i.startsAt, i.timezone);
  if (dias === null) return "Fecha por confirmar.";
  if (dias < 0) return "Ya pasó la fecha programada.";
  if (dias === 0) return "¡Es hoy!";
  if (dias === 1) return "¡Es mañana!";
  return `Faltan ${dias} días.`;
}

function WidgetDestacada({ destacada, idioma }: { destacada: ResumenDeInscripcion; idioma: Idioma }) {
  const mensaje = mensajeDeReadiness(destacada.status, destacada.readiness);

  return (
    <section className="rounded-2xl border border-neutral-800 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight text-neutral-50">
            {destacada.eventName}
          </h2>
          <p className="mt-1 text-sm text-neutral-400">{mensajeDeCuentaRegresiva(destacada)}</p>
        </div>
        <EstadoBadge status={destacada.eventStatus} />
      </div>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row">
        <div className="aspect-square w-full shrink-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 lg:w-64">
          {destacada.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={destacada.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-neutral-600">
              Sin afiche cargado
            </div>
          )}
        </div>

        <dl className="grid flex-1 grid-cols-1 content-start gap-x-8 gap-y-4 sm:grid-cols-2">
          <Fila etiqueta="Categoría">{destacada.divisionName}</Fila>
          <Fila etiqueta="Dorsal">{destacada.bib !== null ? `#${destacada.bib}` : "Se asigna al confirmar"}</Fila>
          <Fila etiqueta="Fecha">
            {rangoDeFechas(destacada.startsAt, null, destacada.timezone, idioma)}
          </Fila>
          <Fila etiqueta="Sede">{destacada.venue ?? "Sin definir"}</Fila>
          <Fila etiqueta="Mi inscripción">
            <span className={`rounded-lg px-2 py-0.5 text-xs font-medium ${claseDePastilla(destacada.status)}`}>
              {textoDeEstado(destacada.status)}
            </span>
            {mensaje && (
              <span
                className={`ml-2 text-xs font-medium ${destacada.readiness === "listo" ? "text-lime-400" : "text-amber-400"}`}
              >
                {mensaje}
              </span>
            )}
          </Fila>
          <Fila etiqueta="Ficha pública">
            <a
              href={`/eventos/${destacada.eventSlug}`}
              target="_blank"
              rel="noreferrer"
              className="text-lime-400 hover:underline"
            >
              Ver ficha pública →
            </a>
          </Fila>
        </dl>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
        {destacada.status === "esperando_pago" && (
          <Link
            href={`/inscripcion/${destacada.id}`}
            className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950 hover:bg-lime-300"
          >
            Completar pago
          </Link>
        )}
        {destacada.status === "confirmada" && destacada.readiness === "accion_requerida" && (
          <Link
            href={`/inscripcion/${destacada.id}`}
            className="rounded-xl border border-amber-400/40 px-4 py-2 text-sm font-medium text-amber-300 hover:bg-neutral-900"
          >
            Completar mi inscripción
          </Link>
        )}
        {destacada.bib !== null && (
          <Link
            href={`/panel/en-vivo/${destacada.eventSlug}/atleta/${destacada.bib}`}
            className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
          >
            Mi resultado completo →
          </Link>
        )}
        <Link
          href={`/eventos/${destacada.eventSlug}/cronograma`}
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
        >
          Cronograma →
        </Link>
      </div>
    </section>
  );
}

/**
 * `LeaderboardLive` con `categoria` fija no avisa cuando ESA categoria en
 * particular no tiene ninguna fila todavia (solo se calla si el EVENTO
 * entero esta vacio) -- se queda mostrando la cabecera con un `<ul>` vacio
 * abajo. Este guard filtra antes de montarlo y muestra su propio mensaje en
 * ese caso puntual.
 */
function WidgetLeaderboardDeCategoria({
  slug,
  eventName,
  categoria,
  leaderboard,
}: {
  slug: string;
  eventName: string;
  categoria: string;
  leaderboard: Leaderboard;
}) {
  const filas = leaderboard.rows.filter((r) => r.divisionName === categoria);

  return (
    <div className="rounded-2xl border border-neutral-800 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold tracking-widest text-neutral-500 uppercase">
          Leaderboard — {categoria}
        </h3>
        <Link href={`/panel/en-vivo/${slug}`} className="shrink-0 text-xs text-lime-400 hover:underline">
          Ver todo →
        </Link>
      </div>

      <div className="mt-3 max-h-72 overflow-y-auto">
        {filas.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-600">
            Todavía no hay resultados en tu categoría.
          </p>
        ) : (
          <LeaderboardLive
            slug={slug}
            inicial={leaderboard}
            eventName={eventName}
            compacto
            categoria={categoria}
            mostrarProyector={false}
          />
        )}
      </div>
    </div>
  );
}

function WidgetMisResultadosCircuito({
  resultado,
}: {
  resultado: Extract<ResultadoDeAtleta, { format: "circuito" }>;
}) {
  const { row, rivales, official } = resultado;
  const enCarrera = row.status === "running";

  return (
    <div className="rounded-2xl border border-neutral-800 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-widest text-neutral-500 uppercase">
          Mis resultados
        </h3>
        <p className="shrink-0 text-xs text-neutral-600 uppercase">
          {official ? "Oficial" : "No oficial"}
        </p>
      </div>

      <p className="mt-3 font-mono text-3xl font-black tabular-nums">
        {row.status === "dnf"
          ? "DNF"
          : row.status === "dq"
            ? "DQ"
            : row.totalMs !== null
              ? formatElapsed(row.totalMs)
              : enCarrera
                ? "En carrera"
                : "—"}
      </p>

      {row.status === "finished" && (
        <p className="mt-1 text-sm text-neutral-400">
          Puesto <strong className="text-lime-400">{row.position}</strong> de {rivales.length}
        </p>
      )}

      {row.penaltyMs > 0 && (
        <p className="mt-1 text-xs text-amber-400">
          Incluye +{formatElapsed(row.penaltyMs, { centis: false })} de penalización
        </p>
      )}
    </div>
  );
}

function WidgetMisResultadosCrossfit({
  resultado,
  eventSlug,
}: {
  resultado: Extract<ResultadoDeAtleta, { format: "crossfit" }>;
  eventSlug: string;
}) {
  const { tabla, fila, official } = resultado;

  return (
    <div className="rounded-2xl border border-neutral-800 p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-widest text-neutral-500 uppercase">
          Mis resultados por WOD
        </h3>
        <Link
          href={`/panel/en-vivo/${eventSlug}`}
          className="shrink-0 text-xs text-lime-400 hover:underline"
        >
          Ver leaderboard completo →
        </Link>
      </div>
      <p className="mt-1 mb-3 text-xs text-neutral-600 uppercase">
        {official ? "Resultado oficial" : "No oficial · en vivo"}
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

function WidgetMisCompetencias({
  inscripciones,
  idioma,
}: {
  inscripciones: ResumenDeInscripcion[];
  idioma: Idioma;
}) {
  const ordenadas = ordenarParaElListado(inscripciones);

  return (
    <section className="rounded-2xl border border-neutral-800 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-widest text-neutral-500 uppercase">
          Mis competencias
        </h3>
        <Link href="/" className="text-xs text-lime-400 hover:underline">
          Buscar competencias
        </Link>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {ordenadas.map((i) => {
          const enVivo = i.eventStatus === "live" || i.eventStatus === "verifying";
          const pasada = yaPaso(i);
          const mensaje = mensajeDeReadiness(i.status, i.readiness);

          return (
            <li key={i.id}>
              <Link
                href={`/inscripcion/${i.id}`}
                className={`flex flex-col gap-2 rounded-xl border p-3 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                  pasada
                    ? "border-neutral-900 opacity-60 hover:opacity-100"
                    : "border-neutral-800 hover:border-neutral-700"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate font-medium">{i.eventName}</span>
                    {enVivo && (
                      <span className="shrink-0 rounded-full bg-lime-400/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-lime-300 uppercase">
                        En vivo
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-neutral-500">
                    {[i.divisionName, rangoDeFechas(i.startsAt, null, i.timezone, idioma, "")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {mensaje && (
                    <p
                      className={`mt-0.5 text-xs font-medium ${
                        i.readiness === "listo" ? "text-lime-400" : "text-amber-400"
                      }`}
                    >
                      {i.readiness === "listo" ? "✓ " : "○ "}
                      {mensaje}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${claseDePastilla(i.status)}`}
                >
                  {textoDeEstado(i.status)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-neutral-600">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-neutral-200">{children}</dd>
    </div>
  );
}
