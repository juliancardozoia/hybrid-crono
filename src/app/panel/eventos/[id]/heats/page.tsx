import { deleteHeat, type FormState } from "@/features/heats/actions";
import { type TeamOption } from "@/features/heats/components/HeatCard";
import { PantallaDeHeats } from "@/features/heats/components/PantallaDeHeats";
import { getDivisions, getHeats, getJudges, getTeams } from "@/features/events/config/queries";
import { getPruebas } from "@/features/workouts/queries";
import { requireEventAccess } from "@/features/events/lib/access";

export default async function HeatsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event, canManage, canVerify } = await requireEventAccess(id);

  const [heats, teams, divisions, judges, pruebas] = await Promise.all([
    getHeats(id),
    getTeams(id),
    getDivisions(id),
    getJudges(id),
    getPruebas(id),
  ]);

  // Un equipo corre una sola vez POR PRUEBA (`lanes_team_once_per_workout`),
  // no una vez por evento: en un CrossFit de tres WODs cada equipo tiene un
  // carril en cada uno. Por eso el selector necesita saber en qué heat está
  // tomado dentro de CADA prueba, y no un único heat.
  const asignaciones = new Map<string, Record<string, string>>();
  for (const heat of heats) {
    for (const lane of heat.lanes) {
      if (!lane.team_id) continue;
      const porPrueba = asignaciones.get(lane.team_id) ?? {};
      porPrueba[heat.workout_id] = heat.id;
      asignaciones.set(lane.team_id, porPrueba);
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
      asignadoEn: asignaciones.get(t.id) ?? {},
    }));

  // Los que no están en NINGÚN heat de ninguna prueba. Con varias pruebas es
  // deliberadamente conservador: avisa del equipo que quedó afuera de todo, que
  // es el error que arruina una competencia, y no de cada hueco por prueba.
  const sinAsignar = opciones.filter(
    (t) => Object.keys(t.asignadoEn).length === 0,
  ).length;

  // El nombre de la prueba se trae PLANO y se une en memoria, no con un embed
  // `workouts (name)` colgado de getHeats: ese ya es el embed más grande de la
  // app —baja hasta los atletas de cada carril— y es la pantalla que se abre
  // el día del evento.
  const nombresDePruebas = pruebas.map(({ workout }) => ({
    id: workout.id,
    name: workout.name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-neutral-500">
        Los heats son las tandas de largada. Cada carril lleva un equipo y lo sigue un juez.
        {sinAsignar > 0 && (
          <span className="ml-1 text-amber-400">Quedan {sinAsignar} equipo(s) sin ningún heat.</span>
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
        pruebas={nombresDePruebas}
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
