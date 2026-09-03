import Link from "next/link";
import type { EventoPublico } from "../queries";
import { Bandera } from "@/shared/components/Bandera";
import { rangoDeFechas, diasHasta } from "../lib/formato";
import { nombreDePais } from "@/shared/utils/paises";
import { Icono } from "@/shared/components/Icono";
import type { Idioma } from "@/shared/i18n/idiomas";

/**
 * La cabecera de la ficha: afiche, identidad, datos y accion.
 *
 * TODO ALINEADO A UNA MISMA COLUMNA. Antes el afiche y el texto flotaban con
 * separaciones distintas y las fechas caian como parrafos sueltos. Ahora el
 * afiche es un cuadrado de tamaño fijo y a su derecha hay UNA columna: chips,
 * titulo, y una fila de datos con iconos. Los iconos no son decoracion —
 * calendario, lugar, inscripciones— son lo que deja leer los tres datos de un
 * vistazo sin etiquetas que ocupen otro renglon.
 *
 * El afiche es CUADRADO porque asi se diseñan: es lo que el organizador publica
 * en Instagram. Recortarlo a 16:9 le come el nombre y la edicion.
 */

const FORMATO: Record<string, string> = {
  crossfit: "CrossFit",
  carrera_hibrida: "Carrera híbrida",
  mixto: "Mixto",
};

export function CabeceraDelEvento({
  evento,
  slug,
  idioma,
}: {
  evento: EventoPublico;
  slug: string;
  idioma: Idioma;
}) {
  const lugar = [evento.city, evento.state].filter(Boolean).join(", ");
  const paraCerrar = diasHasta(evento.registrationClosesAt, evento.timezone);
  const apremia = paraCerrar !== null && paraCerrar >= 0 && paraCerrar <= 7;

  return (
    <header className="relative overflow-hidden border-b border-neutral-800">
      {/* El afiche de fondo, desenfocado y muy oscurecido: da color a la
          cabecera sin competir con el texto. La version legible va al lado. */}
      {(evento.coverUrl || evento.logoUrl) && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={evento.coverUrl ?? evento.logoUrl ?? ""}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-125 object-cover opacity-20 blur-3xl"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/70 via-neutral-950/85 to-neutral-950" />
        </>
      )}

      <div className="relative mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
        {/* `sm:items-center` alinea el afiche con el bloque de texto. Con
            `items-start` el borde superior del cuadrado quedaba unos pixeles
            por encima de la primera linea —el chip tiene su propio relleno— y se
            leia como un descuadre. */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-8">
          <Afiche evento={evento} />

          {/* `min-w-0` deja que el título largo se corte en vez de estirar la
              fila y empujar el afiche fuera de la pantalla. */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-lime-400/15 px-2.5 py-1 font-semibold text-lime-300">
                {FORMATO[evento.format] ?? evento.format}
              </span>
              {evento.eventType === "virtual" && (
                <span className="rounded-full border border-neutral-700 px-2.5 py-1 text-neutral-400">
                  Virtual
                </span>
              )}
              {evento.country && (
                <span className="flex items-center gap-1.5 rounded-full border border-neutral-700 px-2.5 py-1 text-neutral-400">
                  <Bandera codigo={evento.country} className="h-3 w-4" />
                  {nombreDePais(evento.country)}
                </span>
              )}
            </div>

            <h1 className="text-2xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
              {evento.name}
            </h1>

            {evento.organizerName && (
              <p className="text-sm text-neutral-400">Organiza {evento.organizerName}</p>
            )}

            {/* Los tres datos, en una rejilla que se apila sola. Cada uno con su
                icono: es lo que permite leerlos sin una etiqueta por renglon. */}
            <dl className="mt-1 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <DatoConIcono icono="calendario" etiqueta="Competencia">
                {rangoDeFechas(
                  evento.startsAt,
                  evento.endsAt,
                  evento.timezone,
                  idioma,
                  "Por confirmar",
                )}
              </DatoConIcono>

              {(evento.venue || lugar) && (
                <DatoConIcono icono="lugar" etiqueta="Dónde">
                  {evento.venue || lugar}
                  {evento.venue && lugar && (
                    <span className="block text-sm font-normal text-neutral-400">{lugar}</span>
                  )}
                </DatoConIcono>
              )}

              {evento.shirtSizes.length > 0 && (
                <DatoConIcono icono="personas" etiqueta="Tallas de remera">
                  {evento.shirtSizes.join(" · ")}
                </DatoConIcono>
              )}

              <DatoConIcono icono="inscripcion" etiqueta="Inscripciones">
                {evento.inscripcionesAbiertas ? (
                  <>
                    <span className={apremia ? "text-amber-400" : "text-lime-400"}>Abiertas</span>
                    {apremia && (
                      <span className="block text-sm font-normal text-amber-400/90">
                        {paraCerrar === 0
                          ? "Último día"
                          : paraCerrar === 1
                            ? "Cierran mañana"
                            : `Cierran en ${paraCerrar} días`}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-neutral-400">Cerradas</span>
                )}
              </DatoConIcono>
            </dl>

            <div className="mt-3 flex flex-wrap gap-3">
              <Acciones evento={evento} slug={slug} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function DatoConIcono({
  icono,
  etiqueta,
  children,
}: {
  icono: "calendario" | "lugar" | "inscripcion" | "personas";
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-2.5">
      <Icono nombre={icono} className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
      <div className="min-w-0">
        <dt className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
          {etiqueta}
        </dt>
        <dd className="mt-0.5 font-medium text-neutral-100">{children}</dd>
      </div>
    </div>
  );
}

function Afiche({ evento }: { evento: EventoPublico }) {
  const fuente = evento.logoUrl ?? evento.coverUrl;

  // El `aspect-square` va en el contenedor QUE TIENE EL BORDE. Estaba en un div
  // interno, y entonces la imagen era cuadrada pero el marco visible no: el flex
  // padre estiraba la caja externa a la altura de la fila.
  return (
    <div className="flex aspect-square w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-lg shadow-black/40 sm:w-40 lg:w-48">
      {fuente ? (
        // Imagen de un dominio arbitrario del organizador: <img> y no
        // next/image, que exigiria declarar cada host.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fuente} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-5xl font-black text-neutral-700 select-none">
          {evento.name.trim()[0]?.toUpperCase() ?? "?"}
        </span>
      )}
    </div>
  );
}

function Acciones({ evento, slug }: { evento: EventoPublico; slug: string }) {
  return (
    <>
      {evento.inscripcionesAbiertas ? (
        <Link
          href={`/eventos/${slug}/inscripcion`}
          className="rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300"
        >
          Inscribirme
        </Link>
      ) : (
        <span className="rounded-xl border border-neutral-800 px-6 py-3 text-neutral-500">
          Inscripciones cerradas
        </span>
      )}

      {evento.instagram && (
        <a
          href={`https://instagram.com/${evento.instagram.replace(/^@/, "")}`}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Instagram de la competencia"
          className="flex items-center rounded-xl border border-neutral-700 px-4 py-3 transition-colors hover:bg-neutral-900"
        >
          <Icono nombre="instagram" className="h-5 w-5" />
        </a>
      )}
    </>
  );
}
