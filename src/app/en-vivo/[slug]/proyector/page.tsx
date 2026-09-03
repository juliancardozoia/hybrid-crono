import { notFound } from "next/navigation";
import { Proyector } from "@/features/leaderboard/components/Proyector";
import { getEventInfo, getLeaderboard } from "@/features/leaderboard/queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Proyector — Scora" };

export default async function ProyectorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [info, leaderboard] = await Promise.all([getEventInfo(slug), getLeaderboard(slug)]);

  if (!info) notFound();

  return <Proyector slug={slug} inicial={leaderboard} eventName={info.name} />;
}
