import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/lib/supabase/types";

/** Eventos visibles para el usuario. RLS ya los limita a sus organizaciones. */
export async function listEvents(orgId?: string): Promise<EventRow[]> {
  const supabase = await createClient();
  let query = supabase.from("events").select("*").order("event_date", { ascending: false });

  if (orgId) query = query.eq("org_id", orgId);

  const { data, error } = await query;
  return error || !data ? [] : (data as EventRow[]);
}
