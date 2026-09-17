import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventInfo, getLeaderboard, getTablaGeneral } from "@/features/leaderboard/queries";
import { LeaderboardLive } from "@/features/leaderboard/components/LeaderboardLive";
import { TablaGeneral } from "@/features/leaderboard/components/TablaGeneral";

export const dynamic = "force-dynamic";

/**
 * El leaderboard completo, pero DENTRO del panel -- sin salir de la barra
 * lateral ni el header. Nace del widget "Leaderboard"/"Mis resultados" de
 * `PanoramaDeAtleta`: el link de "Ver leaderboard completo" mandaba antes a
 * `/en-vivo/[slug]`, la pagina PUBLICA, y salir del `/panel` a esa ruta
 * significa perder el chrome del panel enterito -- reportado al probar.
 *
 * NO es `/panel/eventos/[id]/leaderboard` (esa sigue siendo del
 * organizador, gateada por `requireEventAccess`). Un atleta puro no tiene
 * `event_role` en esta competencia -- solo la corre --, asi que esa ruta lo
 * rebota. Esta pagina no pide ningun rol de staff: cualquier cuenta con
 * sesion puede verla, con la MISMA visibilidad que ya tiene la pagina
 * publica (el cliente autenticado solo destraba ANTES los resultados
 * PROPIOS, via `puede_ver_resultados_propios` -- no le da acceso a nada que
 * un visitante anonimo no pudiera terminar viendo tambien).
 *
 * CROSSFIT NO MUESTRA `LeaderboardLive`. Esa lee `results`, que solo llenan
 * las pruebas de CIRCUITO -- un evento sin ninguna deja `leaderboard.rows`
 * vacio PARA SIEMPRE y el componente pinta su propio cartel de "todavia no
 * hay resultados" que nunca se va. Mismo guard que ya usa
 * `/panel/eventos/[id]/leaderboard`. La tabla de puntos por WOD
 * (`TablaGeneral`) ya muestra el resultado de cada prueba directo en la
 * fila, sin esconderlo detras de un click -- clickear una fila solo agrega
 * el DESGLOSE (reps, tiempo, ronda a ronda), no el puntaje en si.
 *
 * `mostrarProyector={false}`: "Ver en pantalla grande" es un atajo de
 * produccion para castear al proyector del venue. No tiene nada que hacer
 * en la vista de un atleta.
 */
export default async function LeaderboardEnPanelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Cliente CON SESION: el propio inscripto ve su resultado y el de su
  // categoria aunque el evento todavia no sea publico -- mismo mecanismo que
  // `/en-vivo/[slug]/atleta/[bib]`.
  const supabase = await createClient();
  const info = await getEventInfo(slug, supabase);
  if (!info) notFound();

  const [leaderboard, general] = await Promise.all([
    getLeaderboard(slug, supabase),
    getTablaGeneral(slug, supabase),
  ]);

  const vacio = leaderboard.rows.length === 0 && general.divisiones.length === 0;

  return (
    <main className="mx-auto w-full max-w-4xl p-4 sm:p-6 lg:p-10">
      <Link href="/panel" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Tu panel
      </Link>

      <div className="mt-2 mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{info.name}</h1>
        <p className="text-sm text-neutral-500">Leaderboard</p>
      </div>

      {vacio ? (
        <div className="rounded-2xl border border-dashed border-neutral-800 p-10 text-center">
          <p className="font-medium text-neutral-300">Todavía no hay resultados</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-neutral-500">
            Aparecen a medida que los atletas van terminando.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {leaderboard.rows.length > 0 && (
            <LeaderboardLive
              slug={slug}
              inicial={leaderboard}
              eventName={info.name}
              compacto
              mostrarProyector={false}
            />
          )}
          <TablaGeneral slug={slug} inicial={general} />
        </div>
      )}
    </main>
  );
}
