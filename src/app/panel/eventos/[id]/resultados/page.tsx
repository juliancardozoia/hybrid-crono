import Link from "next/link";
import { redirect } from "next/navigation";
import { getDivisions } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import { PanelVerificacion } from "@/features/verification/components/PanelVerificacion";
import { getPublications, getVerificationQueue } from "@/features/verification/queries";
import { fechaHoraEnEvento } from "@/shared/utils/fecha";

export const dynamic = "force-dynamic";

export default async function ResultadosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, canVerify, canManage } = await requireEventAccess(id);

  if (!canVerify) redirect(`/panel/eventos/${id}`);

  const [cola, divisiones, publicaciones] = await Promise.all([
    getVerificationQueue(id),
    getDivisions(id),
    getPublications(id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {cola.length} carril(es) con atleta · {cola.filter((c) => c.verified).length} verificados
        </p>
        <a
          href={`/api/eventos/${id}/export`}
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
        >
          Descargar CSV
        </a>
      </div>

      <PanelVerificacion
        eventId={id}
        cola={cola}
        divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
        canManage={canManage}
        yaPublicado={publicaciones.length > 0}
      />

      {publicaciones.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
            Publicaciones
          </h2>
          <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
            {publicaciones.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  {p.divisionId
                    ? divisiones.find((d) => d.id === p.divisionId)?.name ?? "una división"
                    : "Todo el evento"}
                </span>
                <span className="text-neutral-500">
                  {p.filas} resultado(s) ·{" "}
                  {fechaHoraEnEvento(p.publishedAt, event.timezone)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-600">
            Cada publicación es una copia congelada. Republicar no pisa la anterior:{" "}
            <Link href={`/panel/eventos/${id}`} className="underline">
              queda el historial completo
            </Link>
            .
          </p>
        </section>
      )}
    </div>
  );
}
