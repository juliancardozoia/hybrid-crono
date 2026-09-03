import {
  createHeat,
  deleteHeat,
  type FormState,
} from "@/features/heats/actions";
import {
  HeatCard,
  type TeamOption,
} from "@/features/heats/components/HeatCard";
import {
  getDivisions,
  getHeats,
  getJudges,
  getTeams,
} from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import {
  Field,
  FieldRow,
  Select,
  SimpleForm,
} from "@/shared/components/SimpleForm";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";

export default async function HeatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event, canManage, canVerify } = await requireEventAccess(id);

  const [heats, teams, divisions, judges] = await Promise.all([
    getHeats(id),
    getTeams(id),
    getDivisions(id),
    getJudges(id),
  ]);

  // Un equipo corre una sola vez en todo el evento, asi que el selector tiene
  // que saber cual ya esta tomado y por que heat.
  const asignaciones = new Map<string, string>();
  for (const heat of heats) {
    for (const lane of heat.lanes) {
      if (lane.team_id) asignaciones.set(lane.team_id, heat.id);
    }
  }

  const opciones: TeamOption[] = teams.map((t) => ({
    id: t.id,
    label: `#${t.bib_number} · ${
      t.name ??
      (t.members.map((m) => `${m.first_name} ${m.last_name}`).join(" / ") ||
        "sin nombre")
    }`,
    asignadoEn: asignaciones.get(t.id) ?? null,
  }));

  const sinAsignar = opciones.filter((t) => t.asignadoEn === null).length;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-neutral-500">
        Los heats son las tandas de largada. Cada carril lleva un equipo y lo
        sigue un juez.
        {sinAsignar > 0 && (
          <span className="ml-1 text-amber-400">
            Quedan {sinAsignar} equipo(s) sin heat.
          </span>
        )}
      </p>

      {heats.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Sin heats todavía.
        </p>
      ) : (
        heats.map((heat) => (
          <div key={heat.id} className="relative">
            <HeatCard
              eventId={id}
              timezone={event.timezone}
              heat={heat}
              teams={opciones}
              judges={judges}
              canManage={canManage}
              canVerify={canVerify}
            />
            {canManage && heat.started_at === null && (
              <div className="absolute top-4 right-4">
                <FormularioDeEstado
                  accion={quitarHeat.bind(null, id, heat.id)}
                  estadoInicial={{ error: null }}
                  etiqueta="✕"
                  pendienteTexto="…"
                  mensajeDeCarga="Quitando el heat…"
                  title="Quitar heat"
                  className="text-sm text-neutral-700 hover:text-red-400"
                />
              </div>
            )}
          </div>
        ))
      )}

      {canManage && (
        <section className="rounded-2xl border border-neutral-800 p-5">
          <h2 className="mb-4 font-semibold">Nuevo heat</h2>
          <SimpleForm
            action={createHeat}
            submitLabel="Crear heat"
            hidden={{ eventId: id }}
          >
            <FieldRow>
              <Field label="Nombre" name="name" required placeholder="Heat 1" />
              <Field
                label="Carriles"
                name="laneCount"
                type="number"
                placeholder="6"
              />
            </FieldRow>
            <FieldRow>
              <Select
                label="División (opcional)"
                name="divisionId"
                options={[
                  { value: "", label: "Mixto — varias divisiones" },
                  ...divisions.map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
              <Field
                label="Hora de largada (opcional)"
                name="scheduledAt"
                type="datetime-local"
              />
            </FieldRow>
          </SimpleForm>
        </section>
      )}
    </div>
  );
}

async function quitarHeat(
  eventId: string,
  heatId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return deleteHeat(eventId, heatId);
}
