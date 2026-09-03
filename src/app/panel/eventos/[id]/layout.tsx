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
  const { event, canManage } = await requireEventAccess(id);

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 lg:p-10">
      {/* El nombre se repite aquí, y a propósito: la barra lateral lo muestra
          truncado a 64 caracteres de ancho y en un celular ni siquiera está
          abierta. Es el título de la página, no una migaja de navegación. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-neutral-500">
            {[event.venue, event.event_date].filter(Boolean).join(" · ") || "Sin fecha ni sede"}
          </p>
        </div>
        <EstadoBadge status={event.status} />
      </div>

      <EventTabs eventId={id} formato={event.format} canManage={canManage} />

      <div className="mt-6">{children}</div>
    </div>
  );
}
