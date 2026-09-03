import Link from "next/link";
import type { EventoPublico } from "../queries";
import { Bandera } from "@/shared/components/Bandera";
import { rangoDeFechas, fechaCorta, diasHasta } from "../lib/formato";
import { horaEnEvento } from "@/shared/utils/fecha";
import { nombreDePais } from "@/shared/utils/paises";
import type { Idioma } from "@/shared/i18n/idiomas";
import { crearTraductor, localeDeIntl } from "@/shared/i18n/diccionario";

/**
 * La ficha publica de una competencia.
 *
 * ORDEN DE LA PAGINA, QUE ES LA DECISION PRINCIPAL
 *
 * Un atleta que abre esto viene a resolver cuatro cosas, en este orden:
 *
 *   1. ¿que es y cuando?          -> portada
 *   2. ¿en que categoria entro    -> categorias, con PRECIO y CUPO a la vista
 *      y cuanto sale?
 *   3. ¿que voy a tener que       -> pruebas
 *      hacer?
 *   4. ¿a que hora me presento?   -> cronograma
 *
 * Las ticketeras ponen las condiciones legales a mitad de pagina y el precio
 * escondido detras de un boton. Aca los terminos van al final —importan cuando
 * ya decidiste— y el precio esta en la lista de categorias, que es donde se
 * decide.
 *
 * LA BARRA DE ACCION ES STICKY EN EL CELULAR. La pagina es larga y el boton de
 * inscribirse quedaba arriba de todo: hay que hacer scroll de vuelta para
 * apretarlo, y eso se pierde gente. En pantalla grande no hace falta porque el
 * boton de la portada nunca queda tan lejos.
 *
 * LA NAVEGACION SON ANCLAS, NO PESTAÑAS. Una pestaña necesita estado en el
 * cliente y no se puede enlazar; un ancla se comparte ("mirá el cronograma"),
 * funciona con el boton de atras y deja la pagina entera renderizada en el
 * servidor y indexable.
 */

const FORMATO: Record<string, string> = {
  crossfit: "CrossFit",
  carrera_hibrida: "Carrera híbrida",
  mixto: "Mixto",
};

const SEXO: Record<string, string> = {
  male: "Masculino",
  female: "Femenino",
  mixed: "Mixta",
  any: "Abierta",
};

const ESQUEMA: Record<string, string> = {
  circuito: "Circuito cronometrado",
  libre: "For Time",
  cap: "For Time con cap",
  ventana: "AMRAP",
  intervalos: "Intervalos",
  sin_reloj: "Carga máxima",
};

export function FichaPublica({
  evento,
  slug,
  idioma,
}: {
  evento: EventoPublico;
  slug: string;
  idioma: Idioma;
}) {
  const t = crearTraductor(idioma);
  const lugar = [evento.city, evento.state].filter(Boolean).join(", ");
  const paraCerrar = diasHasta(evento.registrationClosesAt, evento.timezone);

  const secciones = [
    { id: "info", label: "Info" },
    evento.divisions.length > 0 && { id: "categorias", label: "Categorías" },
    evento.workouts.length > 0 && { id: "pruebas", label: "Pruebas" },
    evento.schedule.length > 0 && { id: "cronograma", label: "Cronograma" },
  ].filter(Boolean) as Array<{ id: string; label: string }>;

  return (
    <>
      <Portada evento={evento} slug={slug} idioma={idioma} lugar={lugar} />

      {secciones.length > 1 && (
        <nav className="sticky top-[57px] z-10 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur">
          <div className="tabs-scroll mx-auto flex w-full max-w-5xl gap-1 px-4">
            {secciones.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="border-b-2 border-transparent px-3 py-3 text-sm whitespace-nowrap text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
              >
                {s.label}
              </a>
            ))}
          </div>
        </nav>
      )}

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-10 pb-28 lg:pb-10">
        <section id="info" className="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-start">
          <div className="flex flex-col gap-6 lg:order-1">
            {evento.description && (
              <div className="leading-relaxed whitespace-pre-line text-neutral-300">
                {evento.description}
              </div>
            )}

            {evento.divisions.length > 0 && (
              <Categorias
                divisiones={evento.divisions}
                abiertas={evento.inscripcionesAbiertas}
                idioma={idioma}
                pais={evento.country}
              />
            )}
          </div>

          {/* La columna de datos va PRIMERA en el HTML y a la derecha en
              pantalla grande: en el celular las fechas y el lugar tienen que
              aparecer antes que un texto largo del organizador. */}
          <aside className="flex flex-col gap-4 lg:order-2">
            <Datos evento={evento} lugar={lugar} paraCerrar={paraCerrar} idioma={idioma} />
          </aside>
        </section>

        {evento.workouts.length > 0 && (
          <Pruebas workouts={evento.workouts} formato={evento.format} />
        )}

        {evento.schedule.length > 0 && (
          <Cronograma schedule={evento.schedule} timezone={evento.timezone} />
        )}

        <Legales evento={evento} />

        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← {t("inicio.proximas")}
        </Link>
      </main>

      <BarraDeAccion evento={evento} slug={slug} idioma={idioma} />
    </>
  );
}

// ---------------------------------------------------------------------------

function Portada({
  evento,
  slug,
  idioma,
  lugar,
}: {
  evento: EventoPublico;
  slug: string;
  idioma: Idioma;
  lugar: string;
}) {
  return (
    <header className="relative overflow-hidden border-b border-neutral-800">
      {/* La portada del organizador de fondo, muy oscurecida y desenfocada. Es
          decoracion: la version legible se muestra al lado. Sin el velo, un
          afiche claro deja el titulo blanco ilegible. */}
      {evento.coverUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={evento.coverUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/60 to-neutral-950" />
        </>
      )}

      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:gap-8">
        <Afiche evento={evento} />

        <div className="flex min-w-0 flex-col gap-3">
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

          <h1 className="text-3xl leading-tight font-bold tracking-tight text-balance sm:text-4xl">
            {evento.name}
          </h1>

          <p className="text-lg text-neutral-200">
            {rangoDeFechas(evento.startsAt, evento.endsAt, evento.timezone, idioma)}
          </p>
          {(evento.venue || lugar) && (
            <p className="text-neutral-400">
              {[evento.venue, lugar].filter(Boolean).join(" · ")}
            </p>
          )}
          {evento.organizerName && (
            <p className="text-sm text-neutral-500">Organiza {evento.organizerName}</p>
          )}

          <div className="mt-2 hidden flex-wrap gap-3 lg:flex">
            <Acciones evento={evento} slug={slug} />
          </div>
        </div>
      </div>
    </header>
  );
}

/** El afiche cuadrado. Es lo que el organizador diseña para redes. */
function Afiche({ evento }: { evento: EventoPublico }) {
  const fuente = evento.logoUrl ?? evento.coverUrl;

  return (
    <div className="w-32 shrink-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 sm:w-44">
      <div className="flex aspect-square items-center justify-center">
        {fuente ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fuente} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-5xl font-black text-neutral-700 select-none">
            {evento.name.trim()[0]?.toUpperCase() ?? "?"}
          </span>
        )}
      </div>
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

      {evento.resultadosVisibles && (
        <Link
          href={`/en-vivo/${slug}`}
          className="rounded-xl border border-neutral-700 px-6 py-3 font-semibold transition-colors hover:bg-neutral-900"
        >
          Ver resultados
        </Link>
      )}
    </>
  );
}

/**
 * La barra pegada al pie, solo en pantalla chica.
 *
 * La ficha es larga y el boton de la portada queda a varias pantallas de
 * distancia: quien termina de leer las categorias tendria que volver arriba.
 */
function BarraDeAccion({
  evento,
  slug,
  idioma,
}: {
  evento: EventoPublico;
  slug: string;
  idioma: Idioma;
}) {
  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur lg:hidden">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {evento.startsAt
              ? rangoDeFechas(evento.startsAt, evento.endsAt, evento.timezone, idioma)
              : evento.name}
          </p>
          {evento.venue && <p className="truncate text-xs text-neutral-500">{evento.venue}</p>}
        </div>

        {evento.inscripcionesAbiertas ? (
          <Link
            href={`/eventos/${slug}/inscripcion`}
            className="shrink-0 rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950"
          >
            Inscribirme
          </Link>
        ) : evento.resultadosVisibles ? (
          <Link
            href={`/en-vivo/${slug}`}
            className="shrink-0 rounded-xl border border-neutral-700 px-5 py-3 font-semibold"
          >
            Resultados
          </Link>
        ) : (
          <span className="shrink-0 rounded-xl border border-neutral-800 px-5 py-3 text-sm text-neutral-500">
            Cerradas
          </span>
        )}
      </div>
    </div>
  );
}

/** Las fechas y el lugar, en una tarjeta que se lee de un vistazo. */
function Datos({
  evento,
  lugar,
  paraCerrar,
  idioma,
}: {
  evento: EventoPublico;
  lugar: string;
  paraCerrar: number | null;
  idioma: Idioma;
}) {
  const apremia = paraCerrar !== null && paraCerrar >= 0 && paraCerrar <= 7;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-5">
      <Dato etiqueta="Competencia">
        {rangoDeFechas(evento.startsAt, evento.endsAt, evento.timezone, idioma, "Por confirmar")}
      </Dato>

      <Dato etiqueta="Inscripciones">
        {evento.registrationOpensAt || evento.registrationClosesAt ? (
          <>
            {rangoDeFechas(
              evento.registrationOpensAt,
              evento.registrationClosesAt,
              evento.timezone,
              idioma,
              fechaCorta(evento.registrationClosesAt!, evento.timezone, idioma),
            )}
            {apremia && (
              <span className="mt-1 block text-sm font-semibold text-amber-400">
                {paraCerrar === 0
                  ? "Último día"
                  : paraCerrar === 1
                    ? "Cierran mañana"
                    : `Cierran en ${paraCerrar} días`}
              </span>
            )}
          </>
        ) : evento.inscripcionesAbiertas ? (
          "Abiertas"
        ) : (
          "Cerradas"
        )}
      </Dato>

      {(evento.venue || lugar || evento.address) && (
        <Dato etiqueta="Dónde">
          {evento.venue && <span className="block">{evento.venue}</span>}
          {evento.address && (
            <span className="block text-sm text-neutral-400">{evento.address}</span>
          )}
          {lugar && (
            <span className="mt-0.5 flex items-center gap-1.5 text-sm text-neutral-400">
              <Bandera codigo={evento.country} className="h-3 w-4" />
              {[lugar, nombreDePais(evento.country)].filter(Boolean).join(", ")}
            </span>
          )}
        </Dato>
      )}

      {evento.shirtSizes.length > 0 && (
        <Dato etiqueta="Tallas de remera">{evento.shirtSizes.join(" · ")}</Dato>
      )}
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">{etiqueta}</p>
      <div className="mt-1 font-medium text-neutral-100">{children}</div>
    </div>
  );
}

/**
 * Las categorias, con PRECIO y CUPO.
 *
 * Es la seccion que decide la inscripcion, y hasta ahora solo mostraba nombres:
 * para saber cuanto costaba habia que empezar el tramite. Media docena de
 * categorias, media docena de tramites a medias.
 */
function Categorias({
  divisiones,
  abiertas,
  idioma,
  pais,
}: {
  divisiones: EventoPublico["divisions"];
  abiertas: boolean;
  idioma: Idioma;
  pais: string | null;
}) {
  return (
    <section id="categorias" className="flex scroll-mt-32 flex-col gap-4">
      <h2 className="text-lg font-semibold">Categorías</h2>

      <ul className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800">
        {divisiones.map((d) => {
          const agotada = d.cuposDisponibles === 0;
          const quedanPocos =
            d.cuposDisponibles !== null && d.cuposDisponibles > 0 && d.cuposDisponibles <= 5;

          return (
            <li
              key={d.name}
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3.5 ${
                agotada ? "opacity-60" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium">{d.name}</p>
                <p className="text-sm text-neutral-500">
                  {[
                    d.teamSize === 1 ? "Individual" : `Equipos de ${d.teamSize}`,
                    SEXO[d.genderRule] ?? d.genderRule,
                    (d.ageMin || d.ageMax) && `${d.ageMin ?? "?"}–${d.ageMax ?? "?"} años`,
                    d.level,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <div className="text-right">
                <p className="font-semibold tabular-nums">
                  {d.priceCents === null
                    ? "Gratis"
                    : precio(d.priceCents, d.currency ?? "COP", idioma, pais)}
                </p>
                <p className="text-xs text-neutral-500">
                  {/* Sin limite se dice explicitamente: "ilimitado" tranquiliza
                      tanto como "quedan 3" apura. Un hueco no dice ninguna de
                      las dos. */}
                  {d.capacity === null
                    ? "Cupo ilimitado"
                    : agotada
                      ? "Sin cupo"
                      : quedanPocos
                        ? `Quedan ${d.cuposDisponibles}`
                        : `${d.cuposDisponibles} de ${d.capacity} disponibles`}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {!abiertas && (
        <p className="text-sm text-neutral-500">
          Las inscripciones no están abiertas en este momento.
        </p>
      )}
    </section>
  );
}

/**
 * El precio, SIN decimales y con las convenciones de quien lee.
 *
 * Un peso colombiano no se escribe con centavos: "$ 180.000,00" es ruido en la
 * pantalla donde alguien decide si se anota.
 *
 * EL LOCALE COMBINA IDIOMA + PAIS DEL EVENTO, y eso hace exactamente lo que
 * hace falta en cada caso:
 *
 *   es + CO -> "$ 180.000"      un colombiano lee su moneda como la escribe
 *   en + CO -> "COP 180,000"    a un extranjero el simbolo "$" solo lo confunde
 *                               —podria ser dolares— asi que aparece el codigo
 *
 * Es la misma familia de decision que usar el huso del EVENTO para las horas,
 * con un matiz: ahi el dato es del evento y punto; aca ademas tiene que ser
 * legible para quien mira desde otro pais.
 */
function precio(
  centavos: number,
  moneda: string,
  idioma: Idioma,
  pais: string | null,
): string {
  const locale = pais ? `${idioma}-${pais.toUpperCase()}` : localeDeIntl(idioma);
  const opciones = { style: "currency", currency: moneda, maximumFractionDigits: 0 } as const;

  try {
    return new Intl.NumberFormat(locale, opciones).format(centavos / 100);
  } catch {
    try {
      // Un par idioma-pais que `Intl` no conozca no puede dejar sin precio la
      // pantalla donde se decide la inscripcion.
      return new Intl.NumberFormat(localeDeIntl(idioma), opciones).format(centavos / 100);
    } catch {
      return `${moneda} ${Math.round(centavos / 100)}`;
    }
  }
}

function Pruebas({
  workouts,
  formato,
}: {
  workouts: EventoPublico["workouts"];
  formato: string;
}) {
  return (
    <section id="pruebas" className="flex scroll-mt-32 flex-col gap-4">
      <h2 className="text-lg font-semibold">
        {formato === "carrera_hibrida" ? "El circuito" : "Las pruebas"}
      </h2>

      <ul className="grid gap-3 sm:grid-cols-2">
        {workouts.map((w) => (
          <li key={w.name} className="rounded-2xl border border-neutral-800 p-4">
            <p className="font-medium">{w.name}</p>

            {w.liberado ? (
              <>
                {w.description && (
                  <p className="mt-1.5 whitespace-pre-line text-sm text-neutral-300">
                    {w.description}
                  </p>
                )}
                {w.parts.length > 0 && (
                  <p className="mt-1.5 text-sm text-neutral-500">
                    {w.parts
                      .map((p) =>
                        [
                          p.label && `${p.label}:`,
                          ESQUEMA[p.timeScheme] ?? p.timeScheme,
                          p.windowMs && `de ${Math.round(p.windowMs / 60000)} min`,
                          p.timeCapMs && `cap ${Math.round(p.timeCapMs / 60000)} min`,
                        ]
                          .filter(Boolean)
                          .join(" "),
                      )
                      .join(" · ")}
                  </p>
                )}
              </>
            ) : (
              // El organizador carga las pruebas con anticipacion para
              // configurar al juez; decidir cuando se revelan es suyo.
              <p className="mt-1.5 text-sm text-neutral-600">Se anuncia más adelante</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cronograma({
  schedule,
  timezone,
}: {
  schedule: EventoPublico["schedule"];
  timezone: string;
}) {
  return (
    <section id="cronograma" className="flex scroll-mt-32 flex-col gap-4">
      <h2 className="text-lg font-semibold">Cronograma</h2>

      <ul className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800">
        {schedule.map((h, i) => (
          <li key={i} className="flex items-baseline gap-4 px-4 py-3">
            <span className="w-14 shrink-0 font-mono tabular-nums text-neutral-400">
              {h.scheduledAt ? horaEnEvento(h.scheduledAt, timezone).slice(0, 5) : "—"}
            </span>
            <span className="min-w-0 flex-1">{h.name}</span>
            {h.workout && (
              <span className="truncate text-sm text-neutral-500">{h.workout}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="text-xs text-neutral-600">Horas en el huso de la competencia ({timezone}).</p>
    </section>
  );
}

/**
 * Documentos, terminos y redes.
 *
 * Al FINAL, no a mitad de pagina como en las ticketeras. Los terminos importan
 * cuando ya decidiste inscribirte; ponerlos antes de las categorias es enterrar
 * lo que la gente vino a ver.
 */
function Legales({ evento }: { evento: EventoPublico }) {
  const hayAlgo =
    evento.documents.length > 0 || evento.instagram || evento.website;
  if (!hayAlgo) return null;

  return (
    <section className="flex flex-col gap-4 border-t border-neutral-800 pt-8">
      <h2 className="text-lg font-semibold">Documentos y contacto</h2>

      <div className="flex flex-wrap gap-3 text-sm">
        {evento.documents.map((d) => (
          <a
            key={d.url}
            href={d.url}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-xl border border-neutral-700 px-4 py-2.5 transition-colors hover:bg-neutral-900"
          >
            {d.name}
          </a>
        ))}
        {evento.instagram && (
          <a
            href={`https://instagram.com/${evento.instagram.replace(/^@/, "")}`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-xl border border-neutral-700 px-4 py-2.5 transition-colors hover:bg-neutral-900"
          >
            @{evento.instagram.replace(/^@/, "")}
          </a>
        )}
        {evento.website && (
          <a
            href={evento.website}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-xl border border-neutral-700 px-4 py-2.5 transition-colors hover:bg-neutral-900"
          >
            Sitio web
          </a>
        )}
      </div>
    </section>
  );
}
