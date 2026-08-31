import { redirect } from "next/navigation";
import { createEvent } from "@/features/events/actions";
import { getMyOrganizations } from "@/features/org/queries";
import { Field, SimpleForm } from "@/shared/components/SimpleForm";

export const metadata = { title: "Nueva competencia — Hybrid Crono" };

export default async function NuevoEventoPage() {
  const orgs = await getMyOrganizations();
  const gestionables = orgs.filter((o) => o.role === "owner" || o.role === "admin");

  if (gestionables.length === 0) redirect("/panel/organizacion/nueva");

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Nueva competencia</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Después vas a poder cargar el circuito, las divisiones y los atletas.
        </p>
      </div>

      <SimpleForm
        action={createEvent}
        submitLabel="Crear competencia"
        hidden={{ orgId: gestionables[0].id }}
      >
        <Field label="Nombre" name="name" required placeholder="Hybrid Games 2026" />
        <Field label="Sede" name="venue" placeholder="Bogotá — Coliseo El Salitre" />
        <Field label="Fecha" name="eventDate" type="date" />
      </SimpleForm>
    </main>
  );
}
