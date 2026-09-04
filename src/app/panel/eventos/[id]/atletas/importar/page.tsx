import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportWizard } from "@/features/athletes/components/ImportWizard";
import { getDivisions } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";

export default async function ImportarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);

  if (!canManage) redirect(`/panel/eventos/${id}/atletas`);

  const divisions = await getDivisions(id);

  if (divisions.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-200">
        Crea primero las categorías: el CSV asigna cada atleta por nombre de categoría.{" "}
        <Link href={`/panel/eventos/${id}/divisiones`} className="underline">
          Ir a divisiones
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/panel/eventos/${id}/atletas`}
        className="text-sm text-neutral-500 hover:text-neutral-300"
      >
        ← Atletas
      </Link>

      <ImportWizard eventId={id} divisiones={divisions.map((d) => d.name)} />
    </div>
  );
}
