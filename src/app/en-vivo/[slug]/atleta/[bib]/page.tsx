import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventInfo, getResultadoDeAtleta } from "@/features/leaderboard/queries";
import { ResultadoDelAtleta } from "@/features/leaderboard/components/ResultadoDelAtleta";

export const dynamic = "force-dynamic";

export default async function AtletaPage({
  params,
}: {
  params: Promise<{ slug: string; bib: string }>;
}) {
  const { slug, bib } = await params;
  const numero = Number(bib);

  // Cliente CON SESION, no el anonimo puro: un inscripto o un staff de ESTE
  // evento ven su propio resultado sin importar el plan ni si el evento ya se
  // publico -- el bypass vive en Postgres (`puede_ver_resultados_propios`, ver
  // supabase/migrations/20260921100000_resultados_propios_sin_gate.sql). Sin
  // sesion, se comporta exactamente como el cliente anonimo de siempre: un
  // visitante sin cuenta no gana nada. El leaderboard PUBLICO
  // (`/en-vivo/[slug]`) sigue usando el cliente anonimo puro a proposito --
  // ese si tiene que verse igual para cualquiera, sea quien sea.
  const supabase = await createClient();
  const info = await getEventInfo(slug, supabase);
  if (!info) notFound();

  // `getResultadoDeAtleta` ya resuelve los dos formatos y encuentra la fila
  // de ESTE dorsal; `ResultadoDelAtleta` ya sabe pintarlo. Las dos se
  // reusan tal cual en `/panel/en-vivo/[slug]/atleta/[bib]` -- la misma
  // vista, pero adentro del panel del atleta, sin perder la barra lateral.
  const resultado = await getResultadoDeAtleta(slug, numero, supabase);

  if (!resultado) {
    return <SinResultados slug={slug} bib={bib} eventName={info.name} />;
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-5">
      <div>
        <Link href={`/en-vivo/${slug}`} className="text-sm text-neutral-500 hover:text-neutral-300">
          ← {info.name}
        </Link>
      </div>

      <ResultadoDelAtleta resultado={resultado} />
    </main>
  );
}

function SinResultados({ slug, bib, eventName }: { slug: string; bib: string; eventName: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold">Sin resultados todavía</p>
      <p className="text-sm text-neutral-500">
        El dorsal {bib} aún no tiene tiempos cargados en {eventName}.
      </p>
      <Link href={`/en-vivo/${slug}`} className="text-sm text-lime-400 hover:underline">
        Ver todos los resultados
      </Link>
    </main>
  );
}
