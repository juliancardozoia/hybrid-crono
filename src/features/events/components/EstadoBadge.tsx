import type { EventStatus } from "@/lib/supabase/types";

const ESTADOS: Record<EventStatus, { texto: string; clase: string }> = {
  draft: { texto: "Borrador", clase: "bg-neutral-800 text-neutral-400" },
  ready: { texto: "Listo", clase: "bg-sky-500/15 text-sky-300" },
  live: { texto: "En vivo", clase: "bg-lime-500/15 text-lime-300" },
  verifying: { texto: "Verificando", clase: "bg-amber-500/15 text-amber-300" },
  published: { texto: "Publicado", clase: "bg-emerald-500/15 text-emerald-300" },
};

export function EstadoBadge({ status }: { status: EventStatus }) {
  const { texto, clase } = ESTADOS[status];
  return <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${clase}`}>{texto}</span>;
}
