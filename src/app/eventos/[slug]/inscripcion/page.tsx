import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EncabezadoPublico } from "@/features/catalogo/components/EncabezadoPublico";
import { getFormularioDeInscripcion } from "@/features/inscripciones/queries";
import { ElegirCategoria } from "@/features/inscripciones/components/ElegirCategoria";
import { getPerfil } from "@/features/cuenta/queries";
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

  // Si ya empezo un tramite en ESTE evento (en cualquier categoria), volver a
  // mostrarle "elegir categoria" es un callejon sin salida: `start_registration`
  // rechaza una segunda inscripcion en la misma categoria con un error que no
  // lleva a ningun lado. Se lo manda directo a lo que ya tiene.
  //
  // "Ya tiene un tramite" no es solo "lo creo" (created_by): un integrante
  // INVITADO que reclamo su lugar (`claim_membership`) y despues cerro el
  // navegador antes de completar sus datos tambien tiene un tramite en curso,
  // y antes de este fix no lo encontraba aca -- volvia a "elegir categoria" y
  // chocaba con "ya tenes una inscripcion en esta categoria" sin ningun
  // camino de vuelta. Se buscan las dos señales por separado y se combinan.
  const divisionIds = form.divisions.map((d) => d.id);
  if (divisionIds.length > 0) {
    const supabase = await createClient();

    const { data: comoIntegrante } = await supabase
      .from("registration_members")
      .select("registration_id")
      .eq("profile_id", usuario.id);

    const idsComoIntegrante = (comoIntegrante ?? []).map((m) => m.registration_id);

    const condiciones = [`created_by.eq.${usuario.id}`];
    if (idsComoIntegrante.length > 0) {
      condiciones.push(`id.in.(${idsComoIntegrante.join(",")})`);
    }

    const { data: existente } = await supabase
      .from("registrations")
      .select("id, status")
      .in("division_id", divisionIds)
      .neq("status", "cancelada")
      .or(condiciones.join(","))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existente) {
      // Confirmada ya no es un tramite: el atleta no tiene nada que completar
      // ahi. Lo manda al panel, que es donde ve su inscripcion junto con todo
      // lo demas que hace con esta cuenta.
      if (existente.status === "confirmada") redirect("/panel");
      redirect(`/inscripcion/${existente.id}`);
    }
  }

  const abiertas = form.divisions.filter((d) => d.abierta);
  // Precarga para individual: el atleta ya cargo esto una vez en /cuenta, y
  // reescribirlo en cada competencia nueva es exactamente el trabajo repetido
  // que completar el perfil deberia evitar.
  const perfil = await getPerfil();

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
          <ElegirCategoria
            categorias={abiertas}
            tallas={form.shirtSizes}
            campos={form.fields}
            documentos={form.documents}
            perfil={perfil}
          />
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
