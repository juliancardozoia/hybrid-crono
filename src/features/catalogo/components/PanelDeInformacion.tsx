import type { EventoPublico } from "../queries";
import { Icono } from "@/shared/components/Icono";
import { localeDeIntl } from "@/shared/i18n/diccionario";
import type { Idioma } from "@/shared/i18n/idiomas";
import { PostularseComoJuez } from "./PostularseComoJuez";
import { yaPaso } from "./MarcoDelEvento";

/**
 * La pestaña de informacion: descripcion, categorias con precio, y los enlaces.
 *
 * SIN COLUMNA DE DATOS A LA DERECHA. Tenia una tarjeta con fecha, lugar e
 * inscripciones — exactamente los tres datos que ya estan en la cabecera, dos
 * dedos mas arriba y con los mismos iconos. Repetirlos no agregaba nada y le
 * robaba a las categorias media pantalla de ancho. Las tallas de remera, que
 * eran lo unico que no estaba arriba, se mudaron a la cabecera.
 *
 * LAS CATEGORIAS SON LA SECCION PRINCIPAL. Es donde se decide la inscripcion, y
 * es lo unico que la ficha no decia: para saber cuanto costaba habia que
 * empezar el tramite. Media docena de categorias, media docena de tramites a
 * medias.
 */

const SEXO: Record<string, string> = {
  male: "Masculino",
  female: "Femenino",
  mixed: "Mixta",
  any: "Abierta",
};

export function PanelDeInformacion({
  evento,
  idioma,
}: {
  evento: EventoPublico;
  idioma: Idioma;
}) {
  const enlaces = evento.documents.length > 0 || evento.website;

  return (
    <div className="flex flex-col gap-10">
      {evento.description && (
        <section className="max-w-3xl leading-relaxed whitespace-pre-line text-neutral-300">
          {evento.description}
        </section>
      )}

      {evento.divisions.length > 0 && (
        <Categorias
          divisiones={evento.divisions}
          idioma={idioma}
          pais={evento.country}
          abiertas={evento.inscripcionesAbiertas}
        />
      )}

      {(enlaces || evento.address) && (
        <section className="flex flex-col gap-4 border-t border-neutral-800 pt-8">
          <h2 className="text-lg font-semibold">Documentos y dirección</h2>

          {evento.address && (
            <p className="flex items-start gap-2.5 text-sm text-neutral-400">
              <Icono nombre="lugar" className="mt-0.5 h-4 w-4 shrink-0 text-neutral-600" />
              {[evento.venue, evento.address].filter(Boolean).join(" · ")}
            </p>
          )}

          {enlaces && (
            <div className="flex flex-wrap gap-3">
              {evento.documents.map((d) => (
                <a
                  key={d.url}
                  href={d.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 rounded-xl border border-neutral-800 px-4 py-2.5 text-sm transition-colors hover:border-neutral-700 hover:bg-neutral-900"
                >
                  <Icono nombre="documento" className="h-4 w-4 shrink-0 text-neutral-500" />
                  {d.name}
                </a>
              ))}
              {evento.website && (
                <a
                  href={evento.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 rounded-xl border border-neutral-800 px-4 py-2.5 text-sm transition-colors hover:border-neutral-700 hover:bg-neutral-900"
                >
                  <Icono nombre="flecha" className="h-4 w-4 shrink-0 text-neutral-500" />
                  Sitio web
                </a>
              )}
            </div>
          )}
        </section>
      )}

      <PostularseComoJuez slug={evento.slug} yaPaso={yaPaso(evento)} />
    </div>
  );
}

function Categorias({
  divisiones,
  idioma,
  pais,
  abiertas,
}: {
  divisiones: EventoPublico["divisions"];
  idioma: Idioma;
  pais: string | null;
  abiertas: boolean;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Categorías</h2>

      <ul className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800">
        {divisiones.map((d) => {
          const agotada = d.cuposDisponibles === 0;
          const quedanPocos =
            d.cuposDisponibles !== null && d.cuposDisponibles > 0 && d.cuposDisponibles <= 5;

          return (
            <li
              key={d.name}
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 ${
                agotada ? "opacity-55" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium">{d.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
                  <span className="flex items-center gap-1.5">
                    <Icono nombre="personas" className="h-3.5 w-3.5" />
                    {d.teamSize === 1 ? "Individual" : `Equipos de ${d.teamSize}`}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{SEXO[d.genderRule] ?? d.genderRule}</span>
                  {(d.ageMin || d.ageMax) && (
                    <>
                      <span aria-hidden>·</span>
                      <span>
                        {d.ageMin ?? "?"}–{d.ageMax ?? "?"} años
                      </span>
                    </>
                  )}
                  {d.level && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{d.level}</span>
                    </>
                  )}
                </p>
              </div>

              <div className="text-right">
                <p className="font-semibold tabular-nums">
                  {d.priceCents === null
                    ? "Gratis"
                    : precio(d.priceCents, d.currency ?? "COP", idioma, pais)}
                </p>
                <p
                  className={`text-xs ${
                    agotada
                      ? "text-neutral-500"
                      : quedanPocos
                        ? "font-medium text-amber-400"
                        : "text-neutral-500"
                  }`}
                >
                  {/* Sin limite se dice explicitamente: "ilimitado" tranquiliza
                      tanto como "quedan 3" apura. Un hueco no dice ninguna. */}
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
 * EL LOCALE COMBINA IDIOMA + PAIS DEL EVENTO:
 *
 *   es + CO -> "$ 180.000"      un colombiano lee su moneda como la escribe
 *   en + CO -> "COP 180,000"    a un extranjero el "$" solo lo confundiria con
 *                               dolares, asi que aparece el codigo
 *
 * Y sin centavos: un peso colombiano no se escribe con ellos, y "$ 180.000,00"
 * es ruido en la pantalla donde alguien decide si se anota.
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
