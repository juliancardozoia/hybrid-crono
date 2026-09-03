import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EncabezadoPublico } from "@/features/catalogo/components/EncabezadoPublico";
import { getFormularioDeInscripcion, getInscripcion } from "@/features/inscripciones/queries";
import { reclamarLugar } from "@/features/inscripciones/actions";
import { PanelDeInscripcion } from "@/features/inscripciones/components/PanelDeInscripcion";
import { getPagoDeInscripcion } from "@/features/pagos/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi inscripción — Scora" };

export default async function InscripcionDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?volver=${encodeURIComponent(`/inscripcion/${id}`)}`);

  // Quien llega por el link de invitacion reclama su lugar al abrir. Es
  // idempotente y no falla si el lugar no es suyo: en ese caso simplemente no
  // pasa nada, y RLS decide que puede ver.
  await reclamarLugar(id);

  const inscripcion = await getInscripcion(id);
  if (!inscripcion) notFound();

  const [form, pago] = await Promise.all([
    getFormularioDeInscripcion(inscripcion.evento.publicSlug),
    getPagoDeInscripcion(id),
  ]);

  const yo = inscripcion.integrantes.find((m) => m.profile_id === user.id) ?? null;
  const soyCapitan = inscripcion.registro.created_by === user.id;

  return (
    <>
      <EncabezadoPublico />

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <div>
          <Link
            href={`/eventos/${inscripcion.evento.publicSlug}`}
            className="text-sm text-neutral-500 hover:text-neutral-300"
          >
            ← {inscripcion.evento.name}
          </Link>
          <h1 className="mt-2 text-2xl font-bold">
            {inscripcion.registro.team_name ?? inscripcion.categoria.name}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {inscripcion.categoria.name}
            {inscripcion.categoria.teamSize > 1 &&
              ` · equipo de ${inscripcion.categoria.teamSize}`}
          </p>
        </div>

        <PanelDeInscripcion
          registro={inscripcion.registro}
          integrantes={inscripcion.integrantes}
          teamSize={inscripcion.categoria.teamSize}
          tallas={inscripcion.evento.shirtSizes}
          campos={(form?.fields ?? []).filter(
            (c) =>
              c.scope === "integrante" &&
              (c.divisionId === null || c.divisionId === inscripcion.registro.division_id),
          )}
          documentos={form?.documents ?? []}
          miId={yo?.id ?? null}
          soyCapitan={soyCapitan}
          pago={pago}
        />
      </main>
    </>
  );
}
