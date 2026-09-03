import { notFound } from "next/navigation";
import { LeaderboardLive } from "@/features/leaderboard/components/LeaderboardLive";
import { TablaGeneral } from "@/features/leaderboard/components/TablaGeneral";
import { getEventInfo, getLeaderboard, getTablaGeneral } from "@/features/leaderboard/queries";

// Los resultados cambian mientras corre la competencia: no tiene sentido
// cachear la respuesta del servidor. El refresco fino lo hace el cliente.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const info = await getEventInfo(slug);
  return { title: info ? `${info.name} — Resultados` : "Resultados" };
}

export default async function EnVivoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [info, leaderboard, general] = await Promise.all([
    getEventInfo(slug),
    getLeaderboard(slug),
    getTablaGeneral(slug),
  ]);

  // Un evento que no existe y uno que todavia no es publico dan lo mismo: no
  // hace falta confirmarle a nadie que el slug existe.
  if (!info) notFound();

  return (
    <>
      <LeaderboardLive slug={slug} inicial={leaderboard} eventName={info.name} />
      {/* La tabla general se esconde sola cuando el evento tiene una sola
          prueba: ahi el general y el ranking de esa prueba son lo mismo. */}
      <div className="mx-auto w-full max-w-4xl px-4 pb-10">
        <TablaGeneral slug={slug} inicial={general} />
      </div>
    </>
  );
}
