import Link from "next/link";
import { traduccion } from "@/shared/i18n/servidor";
import { SelectorDeIdioma } from "@/shared/components/SelectorDeIdioma";
import { elegirIdioma } from "@/shared/i18n/acciones";
import type { ClaveDeTexto } from "@/shared/i18n/es";

/**
 * La carcasa de las cuatro pantallas de cuenta: entrar, crear cuenta, recuperar
 * y elegir contraseña nueva.
 *
 * DOS COLUMNAS, Y LA IZQUIERDA NO ES DECORACION
 *
 * Es la primera pantalla que ve alguien que llego por el link de una
 * competencia, y para el "Scora" no significa nada todavia. La columna
 * de la izquierda contesta "¿que es esto y por que le doy mi correo?" mientras
 * la derecha hace el trabajo. En pantalla chica desaparece: ahi el que llega ya
 * venia decidido y el formulario tiene que estar arriba de todo, sin scroll.
 *
 * El formulario vive en una sola columna angosta a proposito. Un login a dos
 * columnas o con los campos anchos de lado a lado se lee mas lento: el ojo
 * tiene que volver al principio en cada campo.
 */

const ARGUMENTOS: Array<{ titulo: ClaveDeTexto; detalle: ClaveDeTexto }> = [
  { titulo: "marca.p1.titulo", detalle: "marca.p1.detalle" },
  { titulo: "marca.p2.titulo", detalle: "marca.p2.detalle" },
  { titulo: "marca.p3.titulo", detalle: "marca.p3.detalle" },
];

export async function PantallaDeCuenta({
  titulo,
  subtitulo,
  children,
  pie,
}: {
  titulo: ClaveDeTexto;
  subtitulo: ClaveDeTexto;
  children: React.ReactNode;
  pie?: React.ReactNode;
}) {
  const { idioma, t } = await traduccion();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Columna de marca. `hidden lg:flex`: en móvil el formulario va primero
          y solo, sin nada que empujarlo debajo del pliegue. */}
      <aside className="relative hidden overflow-hidden border-r border-neutral-800 bg-neutral-900 lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* El resplandor es un gradiente y no una imagen: no hay foto que
            cargar, no hay licencia que pagar y no se pixela en ningún tamaño. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-32 h-[32rem] w-[32rem] rounded-full bg-lime-400/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 -left-24 h-[28rem] w-[28rem] rounded-full bg-lime-400/5 blur-3xl"
        />

        <div className="relative flex items-center justify-between gap-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            Scora<span className="text-lime-400">.</span>
          </Link>
          <SelectorDeIdioma actual={idioma} elegir={elegirIdioma} etiqueta={t("cuenta.idioma")} />
        </div>

        <div className="relative flex flex-col gap-8">
          <h2 className="max-w-md text-3xl leading-tight font-bold tracking-tight">
            {t("marca.lema")}
          </h2>

          <ul className="flex max-w-md flex-col gap-5">
            {ARGUMENTOS.map((a) => (
              <li key={a.titulo} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime-400"
                />
                <span>
                  <span className="block font-semibold">{t(a.titulo)}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-neutral-400">
                    {t(a.detalle)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-neutral-600">{t("marca.gratis")}</p>
      </aside>

      <main className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-14">
        <div className="mx-auto w-full max-w-sm">
          {/* La marca se repite aquí para pantalla chica, donde la columna de la
              izquierda no existe. */}
          <div className="mb-10 flex items-center justify-between gap-4 lg:hidden">
            <Link href="/" className="font-bold tracking-tight">
              Scora<span className="text-lime-400">.</span>
            </Link>
            <SelectorDeIdioma actual={idioma} elegir={elegirIdioma} etiqueta={t("cuenta.idioma")} />
          </div>

          <h1 className="text-2xl font-bold tracking-tight">{t(titulo)}</h1>
          <p className="mt-1.5 text-sm text-neutral-400">{t(subtitulo)}</p>

          <div className="mt-8">{children}</div>

          {pie && <div className="mt-8 text-sm text-neutral-500">{pie}</div>}
        </div>
      </main>
    </div>
  );
}
