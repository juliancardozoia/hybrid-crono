import { deleteHeat, type FormState } from "@/features/heats/actions";
import { type TeamOption } from "@/features/heats/components/HeatCard";
import { PantallaDeHeats } from "@/features/heats/components/PantallaDeHeats";
import { getDivisions, getHeats, getJudges, getTeams } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";

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

  // Un equipo retirado no compite mas, y uno sin aprobar todavia no puede
  // correr (se aprueba desde /atletas): ninguno de los dos tiene sentido
  // ofrecerlo para un carril nuevo. Si ya estaba en uno, ese heat lo sigue
  // mostrando igual — esto solo achica la lista de "para asignar". La
  // garantia real vive en Postgres (`assign_heat_lanes` la exige de nuevo);
  // esto es solo para no ofrecer una opcion que va a fallar.
  const sinAprobar = teams.filter(
    (t) => t.status !== "withdrawn" && !t.approved,
  ).length;

  const opciones: TeamOption[] = teams
    .filter((t) => t.status !== "withdrawn" && t.approved)
    .map((t) => ({
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
        Los heats son las tandas de largada. Cada carril lleva un equipo y lo sigue un juez.
        {sinAsignar > 0 && (
          <span className="ml-1 text-amber-400">Quedan {sinAsignar} equipo(s) sin heat.</span>
        )}
        {sinAprobar > 0 && (
          <span className="ml-1 text-amber-400">
            {sinAprobar} equipo(s) sin aprobar todavía — aprobalos desde Atletas para poder asignarlos.
          </span>
        )}
      </p>

      <PantallaDeHeats
        eventId={id}
        timezone={event.timezone}
        divisiones={divisions.map((d) => ({ id: d.id, name: d.name }))}
        heats={heats}
        opciones={opciones}
        judges={judges}
        canManage={canManage}
        canVerify={canVerify}
        quitarHeat={quitarHeat}
      />
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
