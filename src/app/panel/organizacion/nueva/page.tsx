import { createOrganization } from "@/features/org/actions";
import { Field, SimpleForm } from "@/shared/components/SimpleForm";

export const metadata = { title: "Nueva organización — Hybrid Crono" };

export default function NuevaOrganizacionPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Crear organización</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Es el espacio de tu box o productora. Todos tus eventos, jueces y atletas viven acá
          adentro, separados de los de cualquier otro organizador.
        </p>
      </div>

      <SimpleForm action={createOrganization} submitLabel="Crear organización">
        <Field label="Nombre" name="name" required placeholder="Box Norte" />
      </SimpleForm>
    </main>
  );
}
