import Link from "next/link";
import { requireEventAccess } from "@/features/events/lib/access";
import { getGrillaDeCarga, getPruebas } from "@/features/workouts/queries";
import { describirParte } from "@/features/workouts/lib/describir";
import { GrillaDeScores } from "@/features/workouts/components/GrillaDeScores";
import { RecalcularGeneral } from "@/features/workouts/components/RecalcularGeneral";

export const dynamic = "force-dynamic";

export default async function ScoresPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ prueba?: string }>;
}) {
  const { id } = await params;
  const { prueba } = await searchParams;
  const { canVerify } = await requireEventAccess(id);

  const pruebas = await getPruebas(id);
  const partes = pruebas.flatMap(({ workout, parts }) =>
    parts.map((parte) => ({ workout, parte })),
  );

  // Las pruebas que se cronometran en vivo no se cargan a mano: su resultado lo
  // escribe el recalculo desde el log del juez.
  const cargables = partes.filter(({ parte }) => parte.capture_mode === "manual");
  const elegida = cargables.find(({ parte }) => parte.id === prueba) ?? cargables[0];

  const filas = elegida ? await getGrillaDeCarga(id, elegida.parte.id) : [];

  if (!canVerify) {
    return (
      <p className="mt-6 rounded-2xl border border-neutral-800 p-6 text-sm text-neutral-400">
        Solo el juez principal o la organización cargan resultados.
      </p>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Cargar resultados</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Se guarda uno por uno, y cada cambio queda registrado con quién lo hizo.
          </p>
        </div>
        <RecalcularGeneral eventId={id} />
      </div>

      {cargables.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          {partes.length === 0
            ? "Todavía no hay pruebas creadas."
            : "Todas las pruebas de este evento se capturan en vivo con la app del juez."}
        </p>
      ) : (
        <>
          <nav className="tabs-scroll flex gap-1 border-b border-neutral-800">
            {cargables.map(({ workout, parte }) => {
              const activa = parte.id === elegida?.parte.id;
              return (
                <Link
                  key={parte.id}
                  href={`/panel/eventos/${id}/scores?prueba=${parte.id}`}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                    activa
                      ? "border-lime-400 font-medium text-neutral-100"
                      : "border-transparent text-neutral-500 hover:text-neutral-300"
                  }`}
                >
                  {workout.name}
                  {parte.label && ` ${parte.label}`}
                </Link>
              );
            })}
          </nav>

          {elegida && (
            <>
              <p className="text-sm text-neutral-500">{describirParte(elegida.parte)}</p>
              {filas.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
                  Ninguna categoría inscripta corre esta prueba, o todavía no hay atletas.
                </p>
              ) : (
                <GrillaDeScores
                  eventId={id}
                  partId={elegida.parte.id}
                  scoreUnit={elegida.parte.score_unit}
                  tieneCap={elegida.parte.time_cap_ms !== null}
                  tieneDesempate={elegida.parte.tiebreak_source !== null}
                  filas={filas.map((f) => ({
                    teamId: f.teamId,
                    bib: f.bib,
                    nombre: f.nombre,
                    divisionName: f.divisionName,
                    status: f.score?.status ?? "pendiente",
                    value: f.score?.value_num ?? null,
                    reps: f.score?.value_reps ?? null,
                    capValue: f.score?.value_cap ?? null,
                    tiebreak: f.score?.tiebreak_value ?? null,
                  }))}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
