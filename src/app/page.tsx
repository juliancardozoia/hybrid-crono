import { Suspense } from "react";
import { EncabezadoPublico } from "@/features/catalogo/components/EncabezadoPublico";
import { BarraDeFiltros } from "@/features/catalogo/components/BarraDeFiltros";
import { TarjetaDeEvento } from "@/features/catalogo/components/TarjetaDeEvento";
import { VistosRecientemente } from "@/features/catalogo/components/VistosRecientemente";
import { buscarPorSlugs } from "@/features/catalogo/actions";
import { getCatalogo, getOpcionesDeFiltro } from "@/features/catalogo/queries";
import type { EventFormat } from "@/lib/supabase/types";
import { traduccion } from "@/shared/i18n/servidor";
import { PieDelSitio } from "@/shared/components/PieDelSitio";
import type { Metadata } from "next";

// El catalogo cambia cuando un organizador publica: no tiene sentido servir
// una copia cacheada de hace horas.
export const dynamic = "force-dynamic";

/**
 * El titulo y la descripcion tambien cambian de idioma.
 *
 * Es lo que lee un buscador y lo que se ve al compartir el enlace por WhatsApp,
 * asi que dejarlos fijos en español haria que un atleta brasileño viera la
 * pagina en portugues pero la vista previa del link en español.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await traduccion();
  return {
    title: `${t("inicio.titulo")} — Scora`,
    description: t("inicio.subtitulo"),
  };
}

const POR_PAGINA = 12;

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { idioma, t } = await traduccion();
  const pagina = Math.max(1, Number(params.pagina ?? 1) || 1);

  // Mes y año son independientes: "todos los marzos" y "toda la temporada 2027"
  // son busquedas que la gente hace de verdad. Se filtran contra `event_date`,
  // que ya esta en el huso del evento.
  const numero = (valor: string | undefined) => {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  const filtros = {
    busqueda: params.q,
    pais: params.pais,
    mes: numero(params.mes),
    anio: numero(params.anio),
    formato: params.formato as EventFormat | undefined,
    limite: POR_PAGINA,
    offset: (pagina - 1) * POR_PAGINA,
  };

  const [{ eventos, total }, opciones, destacados] = await Promise.all([
    getCatalogo(filtros),
    getOpcionesDeFiltro(),
    // Los destacados solo en la primera pantalla y sin filtros: si alguien
    // busca algo concreto, mostrarle otra cosa arriba es estorbar.
    Object.keys(params).length === 0
      ? getCatalogo({ destacados: true, limite: 4 })
      : Promise.resolve({ eventos: [], total: 0 }),
  ]);

  const paginas = Math.ceil(total / POR_PAGINA);
  const sinFiltros = Object.keys(params).length === 0;

  function urlDePagina(n: number): string {
    const p = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    );
    p.set("pagina", String(n));
    return `/?${p.toString()}`;
  }

  return (
    <>
      <EncabezadoPublico />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8">
        <section className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("inicio.titulo")}</h1>
            {/* Una sola línea. Antes decía además "Inscríbete, compite y sigue
                los resultados", y en cualquier pantalla que no fuera muy ancha
                caía a dos renglones justo debajo del título: dos bloques de
                texto apilados antes del buscador, que es a lo que se viene. */}
            <p className="mt-2 text-neutral-400">{t("inicio.subtitulo")}</p>
          </div>

          <Suspense fallback={<div className="h-24" />}>
            <BarraDeFiltros opciones={opciones} idioma={idioma} />
          </Suspense>
        </section>

        {destacados.eventos.length > 0 && (
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{t("inicio.destacadas")}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {destacados.eventos.map((evento) => (
                <TarjetaDeEvento key={evento.slug} evento={evento} idioma={idioma} />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold">
              {sinFiltros ? t("inicio.proximas") : t("inicio.resultados")}
            </h2>
            {total > 0 && (
              <span className="text-sm text-neutral-500">
                {total === 1 ? t("inicio.contador.una") : t("inicio.contador.varias", { n: total })}
              </span>
            )}
          </div>

          {eventos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-700 p-10 text-center">
              <p className="text-neutral-400">
                {sinFiltros ? t("inicio.vacio.sinFiltros") : t("inicio.vacio.conFiltros")}
              </p>
              {sinFiltros && (
                <p className="mt-2 text-sm text-neutral-600">{t("inicio.vacio.invitacion")}</p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {eventos.map((evento) => (
                <TarjetaDeEvento key={evento.slug} evento={evento} idioma={idioma} />
              ))}
            </div>
          )}

          {paginas > 1 && (
            <nav className="flex items-center justify-center gap-2 pt-2">
              {Array.from({ length: paginas }, (_, i) => i + 1).map((n) => (
                <a
                  key={n}
                  href={urlDePagina(n)}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    n === pagina
                      ? "bg-neutral-800 font-semibold text-neutral-100"
                      : "text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {n}
                </a>
              ))}
            </nav>
          )}
        </section>

        <VistosRecientemente
          buscar={buscarPorSlugs}
          idioma={idioma}
          titulo={t("inicio.vistos")}
        />
      </main>

      <PieDelSitio />
    </>
  );
}
