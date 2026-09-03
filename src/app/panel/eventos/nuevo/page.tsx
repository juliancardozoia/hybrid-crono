import { redirect } from "next/navigation";
import { createEvent } from "@/features/events/actions";
import { getMyOrganizations } from "@/features/org/queries";
import { asegurarOrganizacion } from "@/features/org/asegurar";
import { FichaDelEvento } from "@/features/events/components/FichaDelEvento";
import { PasosDelAsistente } from "@/features/events/components/PasosDelAsistente";
import { PASOS } from "@/features/events/lib/asistente";

export const metadata = { title: "Nueva competencia — Scora" };

export default async function NuevoEventoPage() {
  const orgs = await getMyOrganizations();
  let gestionables = orgs.filter((o) => o.role === "owner" || o.role === "admin");

  // Ya no hay pantalla de "crea tu organizacion": si no tiene ninguna propia se
  // le crea aqui mismo. El unico caso que queda sin salida es el de alguien
  // invitado como juez a la organizacion de otro, que no tiene por que poder
  // crear competencias ajenas.
  if (gestionables.length === 0) {
    const propia = await asegurarOrganizacion();
    if (!propia) redirect("/panel");
    gestionables = [{ id: propia.id, name: propia.name, slug: "", role: "owner" }];
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 lg:p-10">
      <h1 className="text-2xl font-bold tracking-tight">Nueva competencia</h1>

      <PasosDelAsistente actual="general" eventId={null} />

      <div className="border-b border-neutral-800 pb-5">
        <h2 className="text-xl font-bold tracking-tight">{PASOS[0].titulo}</h2>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">{PASOS[0].ayuda}</p>
      </div>

      <FichaDelEvento
        action={createEvent}
        hidden={{ orgId: gestionables[0].id }}
        evento={null}
        submitLabel="Crear y continuar"
      />

      <p className="text-sm text-neutral-500">
        Se guarda como borrador. Puedes cerrar y seguir después: nada se publica hasta que tú lo
        decidas.
      </p>
    </main>
  );
}
