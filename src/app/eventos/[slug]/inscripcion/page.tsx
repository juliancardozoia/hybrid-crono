import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EncabezadoPublico } from "@/features/catalogo/components/EncabezadoPublico";
import { getFormularioDeInscripcion } from "@/features/inscripciones/queries";
import { ElegirCategoria } from "@/features/inscripciones/components/ElegirCategoria";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const form = await getFormularioDeInscripcion(slug);
  return { title: form ? `Inscripción — ${form.name}` : "Inscripción" };
}

export default async function InscripcionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const form = await getFormularioDeInscripcion(slug);

  if (!form) notFound();

  const usuario = supabaseConfigured()
    ? (await (await createClient()).auth.getUser()).data.user
    : null;

  // La cuenta es obligatoria: cada competidor tiene que poder completar sus
  // propios datos y ver su historial. Se manda al login con la vuelta puesta
  // para no perder el camino.
  if (!usuario) {
    redirect(`/login?volver=${encodeURIComponent(`/eventos/${slug}/inscripcion`)}`);
  }

  const abiertas = form.divisions.filter((d) => d.abierta);

  return (
    <>
      <EncabezadoPublico />

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8">
        <div>
          <Link
            href={`/eventos/${slug}`}
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            ← {form.name}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Inscripción</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Elige en qué categoría vas a competir. Después cargas los datos y, si es por equipos,
            invitás a tus compañeros.
          </p>
        </div>

        {!form.abierta ? (
          <p className="rounded-2xl border border-neutral-800 p-6 text-center text-neutral-400">
            Las inscripciones de esta competencia están cerradas.
          </p>
        ) : abiertas.length === 0 ? (
          <p className="rounded-2xl border border-neutral-800 p-6 text-center text-neutral-400">
            Ninguna categoría tiene inscripciones abiertas en este momento.
          </p>
        ) : (
          <ElegirCategoria categorias={abiertas} />
        )}

        {form.documents.length > 0 && (
          <section className="flex flex-col gap-2 border-t border-neutral-800 pt-6">
            <h2 className="text-sm font-semibold text-neutral-400 uppercase">Antes de inscribirte</h2>
            <div className="flex flex-wrap gap-2">
              {form.documents.map((d) => (
                <a
                  key={d.url}
                  href={d.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
                >
                  {d.name}
                  {d.requiresAcceptance && (
                    <span className="ml-2 text-xs text-amber-400">hay que aceptarlo</span>
                  )}
                </a>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
