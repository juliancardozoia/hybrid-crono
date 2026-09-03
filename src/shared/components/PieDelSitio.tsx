import Link from "next/link";
import { Icono } from "./Icono";

/**
 * El pie del sitio publico.
 *
 * UNA SOLA RED, Y ES INSTAGRAM. Es donde vive el deporte: los organizadores
 * publican ahi los WODs y los atletas los siguen ahi. Una fila de seis iconos
 * de redes que nadie atiende dice lo contrario de lo que pretende — que la
 * cuenta esta viva— y ademas reparte la atencion del unico enlace que importa.
 *
 * LOS ENLACES LEGALES TODAVIA NO TIENEN PAGINA. Van como `<span>` y no como
 * `<Link href="#">`: un enlace que no lleva a ningun lado se ve igual que uno
 * roto, y en el pie —donde alguien busca los terminos justo antes de pagar— eso
 * es peor que no ofrecerlo. Cuando existan las paginas se cambia el `<span>` por
 * un `<Link>` y no hay que tocar nada mas.
 */

const SECCIONES: Array<{ titulo: string; enlaces: Array<{ label: string; href?: string }> }> = [
  {
    titulo: "Scora",
    enlaces: [
      { label: "Competencias", href: "/" },
      { label: "Acerca de nosotros" },
      { label: "Contacto" },
    ],
  },
  {
    titulo: "Organizadores",
    enlaces: [
      { label: "Crear una competencia", href: "/registro" },
      { label: "Planes y precios", href: "/panel/organizacion/plan" },
      { label: "Soporte" },
    ],
  },
  {
    titulo: "Legal",
    enlaces: [{ label: "Términos y condiciones" }, { label: "Política de privacidad" }],
  },
];

const INSTAGRAM = "https://instagram.com/scora.app";

export function PieDelSitio() {
  return (
    <footer className="mt-auto border-t border-neutral-800 bg-neutral-950">
      <div className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          {/* La marca y el argumento, en una columna mas ancha: es lo que
              contesta "¿que es esto?" a quien llego por el link de un evento y
              hace scroll hasta el final. */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Scora<span className="text-lime-400">.</span>
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-neutral-500">
              Competencias de CrossFit y carreras híbridas en Latinoamérica. Inscripciones,
              cronometraje y resultados en vivo.
            </p>

            <a
              href={INSTAGRAM}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Scora en Instagram"
              className="group flex w-fit items-center gap-2.5 rounded-xl border border-neutral-800 py-2 pr-4 pl-2.5 transition-colors hover:border-lime-400/50 hover:bg-neutral-900"
            >
              <Icono
                nombre="instagram"
                className="h-5 w-5 text-neutral-400 transition-colors group-hover:text-lime-400"
              />
              <span className="text-sm font-medium">@scora.app</span>
            </a>
          </div>

          {SECCIONES.map((s) => (
            <nav key={s.titulo} className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold tracking-wider text-neutral-500 uppercase">
                {s.titulo}
              </h2>
              <ul className="flex flex-col gap-2.5 text-sm">
                {s.enlaces.map((e) => (
                  <li key={e.label}>
                    {e.href ? (
                      <Link href={e.href} className="text-neutral-400 hover:text-neutral-100">
                        {e.label}
                      </Link>
                    ) : (
                      // Todavia sin pagina. Ver el comentario de arriba: un
                      // enlace muerto es peor que un texto sin enlace.
                      <span className="cursor-default text-neutral-600" title="Muy pronto">
                        {e.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-neutral-900 pt-6 text-xs text-neutral-600 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Scora</p>
          <p>
            ¿Eres juez?{" "}
            <Link href="/juez" className="text-neutral-400 hover:text-neutral-200">
              Entra a tu carril
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
