import Link from "next/link";
import { deleteTeam, type FormState } from "@/features/athletes/actions";
import { getDivisions, getTeams } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import { AltaDeAtleta } from "@/features/athletes/components/AltaDeAtleta";
import { GrillaDeAtletas } from "@/features/athletes/components/GrillaDeAtletas";

/**
 * El padron de la competencia: quien corre, en que division, con que dorsal.
 *
 * FUNCIONA IGUAL PARA LOS DOS FORMATOS: un atleta es un atleta, corra un
 * circuito o un WOD. Lo unico que cambia entre competencias es la lista de
 * divisiones, que ya llega resuelta.
 *
 * EL ALTA MANUAL ENTRA POR EL MISMO CAMINO QUE LA INSCRIPCION PUBLICA —ver
 * `crearRegistroManual` en `features/athletes/actions.ts`— asi que "estado del
 * registro" no hace falta mostrarlo aca: todo lo que aparece en esta grilla
 * viene de `teams`, que por definicion son inscripciones ya CONFIRMADAS. Los
 * tramites a medias (esperando pago, esperando integrantes) se ven en
 * "Inscripciones", que es la pantalla que ya responde esa pregunta.
 */
export default async function AtletasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);

  const [teams, divisions] = await Promise.all([
    getTeams(id),
    getDivisions(id),
  ]);

  async function quitar(teamId: string, _prev: FormState, _formData: FormData) {
    "use server";
    return deleteTeam(id, teamId);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {teams.length === 0
            ? "Todavía no hay inscriptos."
            : `${teams.length} equipo(s), ${teams.reduce((n, t) => n + t.members.length, 0)} atleta(s).`}
        </p>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/panel/eventos/${id}/atletas/importar`}
              className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
            >
              Importar CSV
            </Link>

            {divisions.length === 0 ? (
              <span
                className="w-fit cursor-not-allowed rounded-xl bg-neutral-900 px-5 py-3 text-sm font-bold text-neutral-600"
                title="Crea primero las categorías"
              >
                Crear atleta
              </span>
            ) : (
              <AltaDeAtleta
                eventId={id}
                divisiones={divisions.map((d) => ({
                  id: d.id,
                  name: d.name,
                  teamSize: d.team_size,
                }))}
              />
            )}
          </div>
        )}
      </div>

      {canManage && divisions.length === 0 && (
        <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          Crea primero las categorías: cada atleta se inscribe en una.
        </p>
      )}

      <GrillaDeAtletas
        teams={teams}
        divisiones={divisions.map((d) => ({ id: d.id, name: d.name }))}
        canManage={canManage}
        alQuitar={canManage ? quitar : undefined}
      />
    </div>
  );
}
