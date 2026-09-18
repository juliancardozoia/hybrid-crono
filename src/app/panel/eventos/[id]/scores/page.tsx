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
  const { canScore, canVerify } = await requireEventAccess(id);

  const pruebas = await getPruebas(id);
  const partes = pruebas.flatMap(({ workout, parts }) =>
    parts.map((parte) => ({ workout, parte })),
  );

  // Quien solo puede cargar (scorekeeper) ve las pruebas manuales, que es lo
  // unico que le compete. Quien puede verificar ve tambien las que se juzgan
  // en vivo: no para cargarlas de cero -eso lo sigue haciendo el juez- sino
  // para corregir un resultado ante una impugnacion o reclamo.
  const visibles = canVerify
    ? partes
    : partes.filter(({ parte }) => parte.capture_mode === "manual");
  const elegida = visibles.find(({ parte }) => parte.id === prueba) ?? visibles[0];

  const filas = elegida
    ? await getGrillaDeCarga(id, elegida.parte.id, elegida.workout.id)
    : [];

  if (!canScore) {
    return (
      <p className="mt-6 rounded-2xl border border-neutral-800 p-6 text-sm text-neutral-400">
        No tienes permiso para cargar resultados en este evento.
      </p>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Resultados</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Se guarda uno por uno, y cada cambio queda registrado con quién lo hizo.
          </p>
        </div>
        <RecalcularGeneral eventId={id} />
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          {partes.length === 0
            ? "Todavía no hay pruebas creadas."
            : "Todas las pruebas de este evento se capturan en vivo con la app del juez."}
        </p>
      ) : (
        <>
          <nav className="tabs-scroll flex gap-1 border-b border-neutral-800">
            {visibles.map(({ workout, parte }) => {
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
                  {parte.capture_mode === "en_vivo" && (
                    <span className="ml-1.5 text-[10px] tracking-wide text-neutral-500 uppercase">
                      en vivo
                    </span>
                  )}
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
                  modo={elegida.parte.capture_mode === "en_vivo" ? "corregir" : "cargar"}
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
                    source: f.score?.source ?? null,
                    corregidoEn: f.score?.corregido_en ?? null,
                    corregidoPorNombre: f.corregidoPorNombre,
                    heatId: f.heatId,
                    heatName: f.heatName,
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
