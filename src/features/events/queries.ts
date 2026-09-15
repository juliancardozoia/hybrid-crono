import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/lib/supabase/types";

/**
 * Eventos visibles para el usuario. RLS ya los limita a lo que puede leer:
 * los de su organizacion, los que colabora, Y (desde
 * `20260914110000_evento_visible_para_inscriptos`) los que corre como
 * ATLETA. Sirve para el sidebar del panel, que solo necesita nombre/estado
 * de la competencia abierta segun la URL — nunca para decidir "esto es mio
 * como organizador", que es exactamente lo que mezclaria las dos cosas.
 */
export async function listEvents(orgId?: string): Promise<EventRow[]> {
  const supabase = await createClient();
  let query = supabase.from("events").select("*").order("event_date", { ascending: false });

  if (orgId) query = query.eq("org_id", orgId);

  const { data, error } = await query;
  return error || !data ? [] : (data as EventRow[]);
}

/**
 * Los eventos que el usuario ADMINISTRA: los de su organizacion, mas los que
 * colabora con un rol que no sea "judge" (un juez ve su carril, no administra
 * nada — ver "Colaborador y juez NO son lo mismo" en CLAUDE.md).
 *
 * Existe aparte de `listEvents()` porque esa devuelve TODO lo que RLS deja
 * leer, y desde que un atleta puede leer su propia competencia (para ver sus
 * resultados), `listEvents()` sola ya no alcanza para responder "que
 * organizo": mezclaria ahi los eventos donde alguien solo compite.
 */
export async function listEventosQueOrganizo(): Promise<EventRow[]> {
  const supabase = await createClient();

  const [{ data: miembros }, { data: staff }] = await Promise.all([
    supabase.from("org_members").select("org_id"),
    supabase.from("event_staff").select("event_id").neq("role", "judge"),
  ]);

  const orgIds = [...new Set((miembros ?? []).map((m) => m.org_id))];
  const eventIdsDeStaff = [...new Set((staff ?? []).map((s) => s.event_id))];

  if (orgIds.length === 0 && eventIdsDeStaff.length === 0) return [];

  const filtros = [
    orgIds.length > 0 ? `org_id.in.(${orgIds.join(",")})` : null,
    eventIdsDeStaff.length > 0 ? `id.in.(${eventIdsDeStaff.join(",")})` : null,
  ].filter((f): f is string => f !== null);

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .or(filtros.join(","))
    .order("event_date", { ascending: false });

  return error || !data ? [] : (data as EventRow[]);
}
