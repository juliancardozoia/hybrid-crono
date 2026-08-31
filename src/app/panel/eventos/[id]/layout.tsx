import Link from "next/link";
import { requireEventAccess } from "@/features/events/lib/access";
import { EventTabs } from "@/features/events/components/EventTabs";
import { EstadoBadge } from "@/features/events/components/EstadoBadge";

export default async function EventoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event, canManage, canVerify } = await requireEventAccess(id);

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-1 text-sm">
        <Link href="/panel" className="text-neutral-500 hover:text-neutral-300">
          ← Competencias
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-neutral-500">
            {[event.venue, event.event_date].filter(Boolean).join(" · ") || "Sin fecha ni sede"}
          </p>
        </div>
        <EstadoBadge status={event.status} />
      </div>

      <EventTabs eventId={id} canManage={canManage} canVerify={canVerify} />

      <div className="mt-6">{children}</div>
    </div>
  );
}
