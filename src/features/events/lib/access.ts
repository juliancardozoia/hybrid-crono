import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EventRow, OrgRole } from "@/lib/supabase/types";

export interface EventAccess {
  event: EventRow;
  role: OrgRole;
  canManage: boolean;
  canVerify: boolean;
}

/**
 * Carga un evento y el rol del usuario en el.
 *
 * RLS ya impide leer eventos ajenos, asi que un `data` vacio significa "no
 * existe o no es tuyo" y las dos respuestas se devuelven igual: distinguirlas
 * le confirmaria a un curioso que el id existe.
 *
 * Esto NO reemplaza la autorizacion de la base. Sirve para decidir que mostrar;
 * quien decide que se puede escribir sigue siendo Postgres.
 */
export async function getEventAccess(eventId: string): Promise<EventAccess | null> {
  const supabase = await createClient();

  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();

  if (!event) return null;

  const { data: role } = await supabase.rpc("event_role", { p_event_id: eventId });

  if (!role) return null;

  const r = role as OrgRole;
  return {
    event: event as EventRow,
    role: r,
    canManage: r === "owner" || r === "admin",
    canVerify: r === "owner" || r === "admin" || r === "head_judge",
  };
}

/** Igual que getEventAccess pero corta el render si no hay acceso. */
export async function requireEventAccess(eventId: string): Promise<EventAccess> {
  const access = await getEventAccess(eventId);
  if (!access) redirect("/panel");
  return access;
}

/** Para server actions: exige rol de gestion antes de escribir. */
export async function requireManage(eventId: string): Promise<EventAccess> {
  const access = await requireEventAccess(eventId);
  if (!access.canManage) redirect(`/panel/eventos/${eventId}`);
  return access;
}
