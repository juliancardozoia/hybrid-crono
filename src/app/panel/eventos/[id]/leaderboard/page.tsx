import Link from "next/link";
import { requireEventAccess } from "@/features/events/lib/access";
import { LeaderboardLive } from "@/features/leaderboard/components/LeaderboardLive";
import { TablaGeneral } from "@/features/leaderboard/components/TablaGeneral";
import { getLeaderboard, getTablaGeneral } from "@/features/leaderboard/queries";

export const dynamic = "force-dynamic";

/**
 * La tabla de clasificacion, como la ve el organizador.
 *
 * ES LA MISMA QUE VE EL PUBLICO, y a proposito: usa `getLeaderboard` y
 * `getTablaGeneral`, las mismas consultas de `/en-vivo/[slug]`. Una segunda
 * implementacion del ranking para el panel es exactamente lo que el proyecto
 * evita en todos lados —hay UN reductor de tiempos y UN motor de puntuacion— y
 * ademas garantizaria que un dia el organizador vea un podio distinto del que ve
 * el atleta.
 *
 * NO ES LA PANTALLA DE VERIFICACION. Aquella —recalculo, anomalias, publicar—
 * vive en `/verificacion` y es trabajo sobre los datos; esta es el resultado.
 * Estaban juntas y era confuso: se entraba a "resultados" buscando la tabla y se
 * encontraba una cola de anomalias.
 */
export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event } = await requireEventAccess(id);

  const [leaderboard, general] = await Promise.all([
    getLeaderboard(event.public_slug),
    getTablaGeneral(event.public_slug),
  ]);

  const vacio = leaderboard.rows.length === 0 && general.divisiones.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Leaderboard</h2>
          <p className="mt-1 text-sm text-neutral-400">
            La clasificación, tal como la ve el público.
          </p>
        </div>

        <Link
          href={`/en-vivo/${event.public_slug}`}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm transition-colors hover:bg-neutral-900"
        >
          Abrir la vista pública →
        </Link>
      </div>

      {vacio ? (
        <div className="rounded-2xl border border-dashed border-neutral-800 p-10 text-center">
          <p className="font-medium text-neutral-300">Todavía no hay resultados</p>
          {/* Puede estar vacío por dos motivos distintos y conviene no
              confundirlos: la competencia no arrancó, o el plan gratuito no
              muestra nada hasta publicar los oficiales. */}
          <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-500">
            Aparecen a medida que los atletas van terminando. Con el plan gratuito, la tabla
            pública se muestra recién cuando publicas los resultados oficiales desde{" "}
            <Link
              href={`/panel/eventos/${id}/verificacion`}
              className="text-lime-400 hover:underline"
            >
              Verificación
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <LeaderboardLive
            slug={event.public_slug}
            inicial={leaderboard}
            eventName={event.name}
            compacto
          />
          {/* Se esconde sola cuando el evento tiene una sola prueba: ahí el
              general y el ranking de esa prueba son lo mismo. */}
          <TablaGeneral slug={event.public_slug} inicial={general} />
        </div>
      )}
    </div>
  );
}
