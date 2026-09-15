import Link from "next/link";
import type { FichaDeCatalogo } from "../queries";
import { nombreDePais } from "@/shared/utils/paises";
import { Bandera } from "@/shared/components/Bandera";
import { diasHasta, fechaCorta, rangoDeFechas } from "../lib/formato";
import { crearTraductor, type Traducir } from "@/shared/i18n/diccionario";
import type { Idioma } from "@/shared/i18n/idiomas";
import type { ClaveDeTexto } from "@/shared/i18n/es";

/**
 * La tarjeta del catalogo.
 *
 * IMAGEN CUADRADA. Los afiches de competencias se diseñan cuadrados —es lo que
 * se publica en Instagram— y meterlos en un 16:9 los recortaba por arriba y por
 * abajo, justo donde estan el nombre del evento y la edicion.
 *
 * EL HOVER AGREGA, NO REVELA. Es la diferencia con las ticketeras que muestran
 * las fechas SOLO al pasar el mouse: en un celular no hay mouse, y ahi la
 * informacion simplemente no existe. Aca lo esencial —nombre, formato, fecha,
 * lugar, si se puede uno inscribir— esta SIEMPRE visible debajo de la imagen. El
 * panel que sube al pasar por encima es un atajo para quien tiene mouse, no la
 * unica via.
 *
 * EL PANEL ES TRASLUCIDO, no un degradado. Se ve el afiche difuminado detras
 * (`backdrop-blur`) y oscurecido lo justo (`/60`) para que el texto blanco siga
 * legible incluso sobre un afiche claro -- el blur hace ese trabajo, no la
 * opacidad sola. Un degradado (oscuro abajo, transparente arriba) fue
 * descartado: encima de un afiche con texto en la mitad superior el nombre del
 * evento competiria con el del organizador.
 *
 * NO HAY ETIQUETA DE "DESTACADO". Los destacados ya viven bajo un titulo que lo
 * dice; repetirlo en cada tarjeta es ruido. La esquina se usa para la BANDERA,
 * que responde algo que la etiqueta no: si la competencia me queda cerca.
 */

const FORMATO: Record<string, ClaveDeTexto> = {
  crossfit: "formato.crossfit",
  carrera_hibrida: "formato.carrera_hibrida",
  mixto: "formato.mixto",
};

export function TarjetaDeEvento({
  evento,
  idioma,
}: {
  evento: FichaDeCatalogo;
  idioma: Idioma;
}) {
  const t = crearTraductor(idioma);
  const lugar = [evento.ciudad, nombreDePais(evento.pais)].filter(Boolean).join(", ");
  const claveFormato = FORMATO[evento.formato];

  const paraCerrar = diasHasta(evento.cierranInscripciones, evento.timezone);
  const paraEmpezar = diasHasta(evento.empiezaEn, evento.timezone);

  return (
    <Link
      href={`/eventos/${evento.slug}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 transition-all hover:-translate-y-0.5 hover:border-neutral-600 hover:shadow-xl hover:shadow-black/40 focus-visible:border-lime-400 focus-visible:outline-none"
    >
      <div className="relative aspect-square overflow-hidden bg-neutral-900">
        <Portada evento={evento} />

        {/* La bandera va sobre una cajita oscura: un afiche claro se comería
            una bandera suelta, y uno oscuro se comería el borde. */}
        {evento.pais && (
          <span className="absolute top-3 right-3 flex items-center rounded-md bg-neutral-950/70 p-1 backdrop-blur-sm">
            <Bandera codigo={evento.pais} className="h-4 w-6" />
          </span>
        )}

        {evento.empiezaEn && (
          <span className="absolute top-3 left-3 rounded-md bg-neutral-950/70 px-2 py-1 text-xs font-bold tracking-wide text-neutral-100 uppercase backdrop-blur-sm">
            {fechaCorta(evento.empiezaEn, evento.timezone, idioma)}
          </span>
        )}

        {/* El panel del hover. `translate-y-full` lo deja fuera de cuadro y solo
            sube con el mouse o con el foco del teclado — sin `focus-within` un
            usuario que navega con Tab nunca lo vería. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-neutral-950/60 p-4 backdrop-blur-md transition-transform duration-200 ease-out group-hover:translate-y-0 group-focus-within:translate-y-0">
          <dl className="flex flex-col gap-1.5 text-xs">
            <Fila
              etiqueta={t("evento.fecha")}
              valor={rangoDeFechas(
                evento.empiezaEn,
                evento.terminaEn,
                evento.timezone,
                idioma,
                "—",
              )}
            />
            {(evento.sede || lugar) && (
              <Fila etiqueta={t("evento.lugar")} valor={evento.sede || lugar} />
            )}
            {evento.cierranInscripciones && (
              <Fila
                etiqueta={t("evento.inscripcion")}
                valor={t("evento.hasta", {
                  fecha: fechaCorta(evento.cierranInscripciones, evento.timezone, idioma),
                })}
              />
            )}
          </dl>

          <p className="mt-3 rounded-lg bg-lime-400 py-2 text-center text-xs font-bold text-lime-950">
            {t("evento.ver")}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2 text-xs">
          {/* El formato es lo primero que alguien busca ("¿esto es CrossFit o
              Hyrox?"), y llevaba el mismo gris apagado que "Virtual" -- un
              dato secundario. Ahora usa el verde de acento de la marca, igual
              que los chips de la cabecera de la ficha (`CabeceraDelEvento`). */}
          <span className="rounded-full bg-lime-400/15 px-2 py-0.5 font-semibold text-lime-300">
            {claveFormato ? t(claveFormato) : evento.formato}
          </span>
          {evento.modalidad === "virtual" && (
            <span className="rounded-full border border-neutral-800 px-2 py-0.5 text-neutral-500">
              {t("evento.virtual")}
            </span>
          )}
        </div>

        <h3 className="leading-snug font-semibold group-hover:text-lime-300">{evento.nombre}</h3>

        <p className="text-sm text-neutral-400">
          {rangoDeFechas(evento.empiezaEn, evento.terminaEn, evento.timezone, idioma, "—")}
        </p>
        {lugar && <p className="truncate text-sm text-neutral-500">{lugar}</p>}

        <p className="mt-auto pt-2 text-xs">
          <EstadoDeInscripcion
            abiertas={evento.inscripcionesAbiertas}
            paraCerrar={paraCerrar}
            paraEmpezar={paraEmpezar}
            t={t}
          />
        </p>
      </div>
    </Link>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      {/* `text-neutral-500` se perdia contra el afiche difuminado de fondo:
          un gris pensado para una tarjeta OPACA no tiene suficiente contraste
          sobre una imagen. `text-neutral-300` mas la sombra se leen incluso
          sobre un afiche claro. */}
      <dt className="shrink-0 text-neutral-300 [text-shadow:0_1px_2px_rgb(0_0_0_/_0.8)]">
        {etiqueta}
      </dt>
      <dd className="truncate text-right font-medium text-neutral-50 [text-shadow:0_1px_2px_rgb(0_0_0_/_0.8)]">
        {valor}
      </dd>
    </div>
  );
}

/**
 * La urgencia, que es lo unico que cambia una decision.
 *
 * "Inscripciones abiertas" es cierto los seis meses previos y no dice nada. "Se
 * cierran en 3 dias" es lo que hace que alguien se anote hoy. Por eso la cuenta
 * atras aparece solo cuando de verdad aprieta —una semana o menos— y en ambar,
 * no en el verde de siempre.
 */
function EstadoDeInscripcion({
  abiertas,
  paraCerrar,
  paraEmpezar,
  t,
}: {
  abiertas: boolean;
  paraCerrar: number | null;
  paraEmpezar: number | null;
  t: Traducir;
}) {
  if (abiertas && paraCerrar !== null && paraCerrar >= 0 && paraCerrar <= 7) {
    const texto =
      paraCerrar === 0
        ? t("evento.cierranHoy")
        : paraCerrar === 1
          ? t("evento.cierranManiana")
          : t("evento.cierran", { n: paraCerrar });
    return <span className="font-semibold text-amber-400">{texto}</span>;
  }

  if (abiertas) return <span className="font-semibold text-lime-400">{t("evento.abiertas")}</span>;

  // Cerradas y la competencia ya paso: decir "inscripciones cerradas" de algo
  // que ocurrio hace un mes es informacion muerta.
  if (paraEmpezar !== null && paraEmpezar < 0) {
    return <span className="text-neutral-600">{t("evento.termino")}</span>;
  }
  return <span className="text-neutral-600">{t("evento.cerradas")}</span>;
}

/**
 * El afiche del organizador, o algo digno cuando todavia no lo subio.
 *
 * `logoUrl` ES EL AFICHE, pese al nombre. `coverUrl` es un campo legado que
 * ninguna pantalla de carga escribe mas (ver `FichaDelEvento.tsx`): el unico
 * lugar donde un organizador sube una imagen es "Afiche de la competencia"
 * (`ImagenDelEvento.tsx`), que guarda en `logoUrl` y previsualiza con
 * `object-cover` porque documenta explicitamente "el object-cover recorta
 * igual que la tarjeta, asi que lo que se ve aqui es lo que se va a ver
 * alla". Tratar `logoUrl` distinto aca —contenido y con relleno, en vez de
 * recortado a pantalla completa— rompia esa promesa: CUALQUIER evento nuevo
 * (que no tiene `coverUrl`, porque nadie lo carga) se veia con el afiche
 * chico y flotando en un cuadrado vacio en vez de ocupar todo el espacio.
 * `CabeceraDelEvento.tsx` ya trataba a `logoUrl` asi (recortado); esto lo
 * alinea.
 */
function Portada({ evento }: { evento: FichaDeCatalogo }) {
  const fuente = evento.coverUrl ?? evento.logoUrl;

  if (fuente) {
    return (
      // Imagen del organizador, de un dominio arbitrario: <img> y no next/image
      // porque el optimizador exige declarar cada host.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fuente}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
    );
  }

  // Sin afiche, la inicial del evento sobre un degradado. Es mejor que un
  // rectangulo vacio: distingue una tarjeta de otra de un vistazo.
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900">
      <span className="text-6xl font-black text-neutral-700 select-none">
        {evento.nombre.trim()[0]?.toUpperCase() ?? "?"}
      </span>
    </div>
  );
}
