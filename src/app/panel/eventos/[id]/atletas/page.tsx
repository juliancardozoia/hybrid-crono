import Link from "next/link";
import { createAthleteTeam, deleteTeam } from "@/features/athletes/actions";
import { getDivisions, getTeams } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import { Field, FieldRow, Select, SimpleForm } from "@/shared/components/SimpleForm";

export default async function AtletasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);

  const [teams, divisions] = await Promise.all([getTeams(id), getDivisions(id)]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {teams.length === 0
            ? "Todavía no hay inscriptos."
            : `${teams.length} equipo(s), ${teams.reduce((n, t) => n + t.members.length, 0)} atleta(s).`}
        </p>
        {canManage && (
          <Link
            href={`/panel/eventos/${id}/atletas/importar`}
            className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
          >
            Importar CSV
          </Link>
        )}
      </div>

      {/*
        Lista y no tabla: una tabla de cuatro columnas en un celular obliga a
        scrollear de costado para ver la division, y el organizador la revisa
        justo el dia del evento, apurado y con el telefono en una mano.
      */}
      {teams.length > 0 && (
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {teams.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <span className="w-12 shrink-0 font-mono text-lg font-bold tabular-nums">
                {t.bib_number}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  {t.name && <span className="mr-2 font-medium">{t.name}</span>}
                  <span className={t.name ? "text-neutral-400" : ""}>
                    {t.members.map((m) => `${m.first_name} ${m.last_name}`).join(" / ") ||
                      "sin integrantes"}
                  </span>
                </p>
                <p className="truncate text-xs text-neutral-500">{t.divisionName}</p>
              </div>

              {canManage && (
                <form action={quitarEquipo.bind(null, id, t.id)} className="shrink-0">
                  <button
                    type="submit"
                    className="px-2 text-neutral-600 hover:text-red-400"
                    title="Quitar equipo"
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
        (divisions.length === 0 ? (
          <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Crea primero las divisiones: cada atleta se inscribe en una.
          </p>
        ) : (
          <section className="rounded-2xl border border-neutral-800 p-5">
            <h2 className="font-semibold">Alta manual</h2>
            <p className="mt-1 mb-4 text-sm text-neutral-500">
              Para los que aparecen el día del evento. Si dejas el dorsal vacío se asigna el
              siguiente libre. Las parejas se cargan por CSV.
            </p>
            <SimpleForm
              action={createAthleteTeam}
              submitLabel="Agregar atleta"
              hidden={{ eventId: id }}
            >
              <FieldRow>
                <Field label="Nombre" name="firstName" required />
                <Field label="Apellido" name="lastName" required />
              </FieldRow>
              <FieldRow>
                <Select
                  label="División"
                  name="divisionId"
                  required
                  options={divisions.map((d) => ({ value: d.id, label: d.name }))}
                />
                <Select
                  label="Sexo"
                  name="gender"
                  options={[
                    { value: "", label: "Sin especificar" },
                    { value: "male", label: "Masculino" },
                    { value: "female", label: "Femenino" },
                    { value: "other", label: "Otro" },
                  ]}
                />
              </FieldRow>
              <FieldRow>
                <Field label="Fecha de nacimiento" name="birthDate" type="date" />
                <Field label="Dorsal (opcional)" name="bibNumber" type="number" />
              </FieldRow>
              <Field label="Email (opcional)" name="email" type="email" />
            </SimpleForm>
          </section>
        ))}
    </div>
  );
}

async function quitarEquipo(eventId: string, teamId: string) {
  "use server";
  await deleteTeam(eventId, teamId);
}
