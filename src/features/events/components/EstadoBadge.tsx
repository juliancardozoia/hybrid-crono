import type { EventStatus } from "@/lib/supabase/types";
import { Badge, type TonoDeBadge } from "@/shared/components/Badge";

const ESTADOS: Record<EventStatus, { texto: string; tono: TonoDeBadge }> = {
  draft: { texto: "Borrador", tono: "neutral" },
  ready: { texto: "Listo", tono: "info" },
  live: { texto: "En vivo", tono: "activo" },
  verifying: { texto: "Verificando", tono: "warning" },
  published: { texto: "Publicado", tono: "exito" },
};

export function EstadoBadge({ status }: { status: EventStatus }) {
  const { texto, tono } = ESTADOS[status];
  return <Badge tono={tono}>{texto}</Badge>;
}
