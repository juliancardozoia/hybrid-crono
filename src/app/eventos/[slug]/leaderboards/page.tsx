import { MarcoDelEvento } from "@/features/catalogo/components/MarcoDelEvento";
import { LeaderboardsTab } from "@/features/leaderboard/components/LeaderboardsTab";
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

  return (
    <MarcoDelEvento slug={slug} activa="leaderboards">
      {(evento) => (
        <LeaderboardsTab
          slug={slug}
          eventName={evento.name}
          leaderboard={leaderboard}
          general={general}
          inscritos={inscritos}
        />
      )}
    </MarcoDelEvento>
  );
}
