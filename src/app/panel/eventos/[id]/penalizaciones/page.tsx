import {
  createPenaltyType,
  seedDefaultPenalties,
  togglePenaltyType,
  type FormState,
} from "@/features/events/config/actions";
import { getPenaltyTypes } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import {
  Field,
  FieldRow,
  Select,
  SimpleForm,
} from "@/shared/components/SimpleForm";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import type { PenaltyKind } from "@/lib/supabase/types";

const TIPOS: Record<PenaltyKind, string> = {
  time_add: "Suma tiempo",
  no_rep: "Repetición inválida",
  dq: "Descalifica",
};

export default async function PenalizacionesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);
  const penalties = await getPenaltyTypes(id);

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-neutral-500">
        Este catálogo es lo que el juez ve al tocar PENALIZAR. Cortito y claro:
        si tiene quince opciones, nadie lo usa bien con un atleta gritando al
        lado.
      </p>

      {penalties.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center">
          <p className="text-sm text-neutral-500">
            Sin penalizaciones cargadas.
          </p>
          {canManage && (
            <div className="mt-3">
              <FormularioDeEstado
                accion={sembrar.bind(null, id)}
                estadoInicial={{ error: null }}
                etiqueta="Cargar el catálogo estándar"
                mensajeDeCarga="Cargando el catálogo…"
                className="text-sm text-lime-400 hover:underline"
              />
            </div>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {penalties.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div className={p.active ? "" : "opacity-40"}>
                <p className="font-medium">
                  {p.label}{" "}
                  <code className="ml-1 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    {p.code}
                  </code>
                </p>
                <p className="text-sm text-neutral-500">
                  {TIPOS[p.kind]}
                  {p.kind === "time_add" && ` · +${p.seconds}s`}
                </p>
              </div>
              {canManage && (
                <FormularioDeEstado
                  accion={alternar.bind(null, id, p.id, !p.active)}
                  estadoInicial={{ error: null }}
                  etiqueta={p.active ? "Desactivar" : "Activar"}
                  pendienteTexto="…"
                  mensajeDeCarga="Actualizando la penalización…"
                  className="text-sm text-neutral-500 hover:text-neutral-200"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <section className="rounded-2xl border border-neutral-800 p-5">
          <h2 className="mb-4 font-semibold">Nueva penalización</h2>
          <SimpleForm
            action={createPenaltyType}
            submitLabel="Agregar"
            hidden={{ eventId: id }}
          >
            <FieldRow>
              <Field label="Código" name="code" required placeholder="ROM" />
              <Field
                label="Descripción"
                name="label"
                required
                placeholder="Rango de movimiento"
              />
            </FieldRow>
            <FieldRow>
              <Select
                label="Tipo"
                name="kind"
                options={[
                  { value: "time_add", label: "Suma tiempo" },
                  { value: "no_rep", label: "Repetición inválida (no suma)" },
                  { value: "dq", label: "Descalifica" },
                ]}
              />
              <Field
                label="Segundos (solo si suma tiempo)"
                name="seconds"
                type="number"
              />
            </FieldRow>
          </SimpleForm>
        </section>
      )}
    </div>
  );
}

async function sembrar(eventId: string, _prev: FormState, _formData: FormData) {
  "use server";
  return seedDefaultPenalties(eventId);
}

async function alternar(
  eventId: string,
  penaltyId: string,
  active: boolean,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return togglePenaltyType(eventId, penaltyId, active);
}
