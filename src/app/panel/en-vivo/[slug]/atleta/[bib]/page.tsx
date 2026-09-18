import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventInfo, getResultadoDeAtleta } from "@/features/leaderboard/queries";
import { ResultadoDelAtleta } from "@/features/leaderboard/components/ResultadoDelAtleta";

export const dynamic = "force-dynamic";

/**
 * "Mi resultado completo", pero DENTRO del panel -- misma vista que
 * `/en-vivo/[slug]/atleta/[bib]` (la publica), sin perder la barra lateral
 * ni el header. Mismo motivo que `/panel/en-vivo/[slug]`: el boton "Mi
 * resultado completo →" del panorama del atleta mandaba a la ruta publica y
 * eso sacaba a la persona del panel entero -- reportado al probar esa misma
 * pantalla.
 *
 * `ResultadoDelAtleta` es el MISMO componente que usa la pagina publica: si
 * un dia cambia como se muestra un WOD o un split, cambia en un solo lugar.
 */
export default async function AtletaEnPanelPage({
  params,
}: {
  params: Promise<{ slug: string; bib: string }>;
}) {
  const { slug, bib } = await params;
  const numero = Number(bib);

  const supabase = await createClient();
  const info = await getEventInfo(slug, supabase);
  if (!info) notFound();

  const resultado = await getResultadoDeAtleta(slug, numero, supabase);

  return (
    <main className="mx-auto w-full max-w-2xl p-4 sm:p-6 lg:p-10">
      <Link
        href={`/panel/en-vivo/${slug}`}
        className="text-sm text-neutral-500 hover:text-neutral-300"
      >
        ← {info.name}
      </Link>

      <div className="mt-6">
        {resultado ? (
          <ResultadoDelAtleta resultado={resultado} />
        ) : (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-lg font-semibold">Sin resultados todavía</p>
            <p className="text-sm text-neutral-500">
              El dorsal {bib} aún no tiene tiempos cargados en {info.name}.
            </p>
            <Link
              href={`/panel/en-vivo/${slug}`}
              className="text-sm text-lime-400 hover:underline"
            >
              Ver todos los resultados
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
