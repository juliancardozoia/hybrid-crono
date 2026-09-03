import { MarcoDelEvento } from "@/features/catalogo/components/MarcoDelEvento";
import { ListaDeLargada } from "@/features/catalogo/components/ListaDeLargada";
import { LeaderboardLive } from "@/features/leaderboard/components/LeaderboardLive";
import { TablaGeneral } from "@/features/leaderboard/components/TablaGeneral";
import { getLeaderboard, getTablaGeneral } from "@/features/leaderboard/queries";
import { getEventoPublico, getInscritos } from "@/features/catalogo/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const evento = await getEventoPublico(slug);
  return { title: evento ? `Leaderboards — ${evento.name}` : "Leaderboards — Scora" };
}

/**
 * Una sola pestaña con DOS vidas.
 *
 * Antes de que empiece la competencia muestra la lista de largada: quién se
 * inscribió en cada categoría. Cuando hay resultados, los muestra. Son la misma
 * pregunta en dos momentos —"¿quiénes están y cómo van?"— y separarlas en dos
 * pestañas dejaría una de las dos vacía la mitad del tiempo.
 */
export default async function LeaderboardsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [leaderboard, general, inscritos] = await Promise.all([
    getLeaderboard(slug),
    getTablaGeneral(slug),
    getInscritos(slug),
  ]);

  const hayResultados = leaderboard.rows.length > 0 || general.divisiones.length > 0;

  return (
    <MarcoDelEvento slug={slug} activa="leaderboards">
      {(evento) =>
        hayResultados ? (
          <div className="flex flex-col gap-4">
            <LeaderboardLive slug={slug} inicial={leaderboard} eventName={evento.name} compacto />
            {/* Se esconde sola cuando el evento tiene una sola prueba: ahí el
                general y el ranking de esa prueba son lo mismo. */}
            <TablaGeneral slug={slug} inicial={general} />
          </div>
        ) : inscritos ? (
          <ListaDeLargada datos={inscritos} />
        ) : null
      }
    </MarcoDelEvento>
  );
}
