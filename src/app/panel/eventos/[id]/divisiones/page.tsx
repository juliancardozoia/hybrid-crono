import { createDivision, deleteDivision } from "@/features/events/config/actions";
import { getCourseTemplates, getDivisions } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import { Field, FieldRow, Select, SimpleForm } from "@/shared/components/SimpleForm";
import type { GenderRule } from "@/lib/supabase/types";

const SEXO: Record<GenderRule, string> = {
  male: "Masculino",
  female: "Femenino",
  mixed: "Mixta",
  any: "Abierta",
};

export default async function DivisionesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);

  const [divisions, templates] = await Promise.all([getDivisions(id), getCourseTemplates(id)]);
  const porId = new Map(templates.map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-neutral-500">
        Una división es una categoría que rankea por separado: individual, parejas del mismo sexo,
        parejas mixtas, con o sin rango de edad.
      </p>

      {divisions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Sin divisiones todavía.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {divisions.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-sm text-neutral-500">
                  {d.team_size === 1 ? "Individual" : `Equipos de ${d.team_size}`} ·{" "}
                  {SEXO[d.gender_rule]}
                  {(d.age_min || d.age_max) && ` · ${d.age_min ?? "?"}–${d.age_max ?? "?"} años`}
                  {d.level && ` · ${d.level}`}
                  <span className="ml-2 text-neutral-600">
                    {porId.get(d.course_template_id) ?? "circuito desconocido"}
                  </span>
                </p>
              </div>
              {canManage && (
                <form action={quitarDivision.bind(null, id, d.id)}>
                  <button
                    type="submit"
                    className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
                    title="Quitar división"
                  >
                    ✕
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage &&
        (templates.length === 0 ? (
          <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Crea primero un circuito: cada división corre uno.
          </p>
        ) : (
          <section className="rounded-2xl border border-neutral-800 p-5">
            <h2 className="mb-4 font-semibold">Nueva división</h2>
            <SimpleForm
              action={createDivision}
              submitLabel="Crear división"
              hidden={{ eventId: id }}
            >
              <Field label="Nombre" name="name" required placeholder="Individual Masculino RX" />
              <FieldRow>
                <Select
                  label="Circuito"
                  name="courseTemplateId"
                  required
                  options={templates.map((t) => ({ value: t.id, label: t.name }))}
                />
                <Select
                  label="Integrantes"
                  name="teamSize"
                  options={[
                    { value: "1", label: "1 — individual" },
                    { value: "2", label: "2 — parejas" },
                    { value: "3", label: "3" },
                    { value: "4", label: "4" },
                  ]}
                />
              </FieldRow>
              <FieldRow>
                <Select
                  label="Sexo"
                  name="genderRule"
                  options={[
                    { value: "any", label: "Abierta" },
                    { value: "male", label: "Masculino" },
                    { value: "female", label: "Femenino" },
                    { value: "mixed", label: "Mixta (uno de cada sexo)" },
                  ]}
                />
                <Field label="Nivel (opcional)" name="level" placeholder="RX / Scaled / Elite" />
              </FieldRow>
              <FieldRow>
                <Field label="Edad mínima (opcional)" name="ageMin" type="number" />
                <Field label="Edad máxima (opcional)" name="ageMax" type="number" />
              </FieldRow>
            </SimpleForm>
          </section>
        ))}
    </div>
  );
}

async function quitarDivision(eventId: string, divisionId: string) {
  "use server";
  await deleteDivision(eventId, divisionId);
}
