import { createClient } from "@/lib/supabase/server";
import type { LaneStatus } from "@/lib/supabase/types";

export interface QueueRow {
  laneId: string;
  bib: number | null;
  divisionName: string | null;
  heatName: string | null;
  status: LaneStatus;
  totalMs: number | null;
  verified: boolean;
  eventCount: number;
  voidedCount: number;
  anomalies: Array<{ code: string; message: string }>;
  startedOffline: boolean;
}

/**
 * Todo lo que la organizacion tiene que mirar antes de publicar.
 *
 * Devuelve vacio para quien no puede verificar: la funcion de Postgres ya
 * filtra por rol, asi que no hace falta chequear de nuevo aca.
 */
export async function getVerificationQueue(eventId: string): Promise<QueueRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("verification_queue", { p_event_id: eventId });

  return ((data as unknown as Array<Record<string, unknown>>) ?? []).map((r) => ({
    laneId: String(r.lane_id),
    bib: (r.bib_number as number | null) ?? null,
    divisionName: (r.division_name as string | null) ?? null,
    heatName: (r.heat_name as string | null) ?? null,
    status: r.status as LaneStatus,
    totalMs: (r.total_ms as number | null) ?? null,
    verified: Boolean(r.verified),
    eventCount: Number(r.event_count ?? 0),
    voidedCount: Number(r.voided_count ?? 0),
    anomalies: Array.isArray(r.anomalies)
      ? (r.anomalies as Array<{ code: string; message: string }>)
      : [],
    startedOffline: Boolean(r.started_offline),
  }));
}

export interface LaneLogEntry {
  id: string;
  seq: number;
  type: string;
  elapsedMs: number;
  segmentName: string | null;
  payload: Record<string, unknown>;
  voided: boolean;
  voidReason: string | null;
  recordedBy: string | null;
  receivedAt: string;
}

/** El log crudo de un carril, para poder discutir un tiempo con evidencia. */
export async function getLaneLog(laneId: string): Promise<LaneLogEntry[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("timing_events")
    .select("*, segments (name), profiles (full_name, email)")
    .eq("lane_id", laneId)
    .order("seq");

  return ((data as unknown as Array<Record<string, unknown>>) ?? []).map((e) => {
    const perfil = e.profiles as { full_name: string | null; email: string | null } | null;
    return {
      id: String(e.id),
      seq: Number(e.seq),
      type: String(e.type),
      elapsedMs: Number(e.elapsed_ms),
      segmentName: (e.segments as { name: string } | null)?.name ?? null,
      payload: (e.payload ?? {}) as Record<string, unknown>,
      voided: Boolean(e.voided),
      voidReason: (e.void_reason as string | null) ?? null,
      recordedBy: perfil?.full_name ?? perfil?.email ?? null,
      receivedAt: String(e.server_received_at),
    };
  });
}

export interface PublicationRow {
  id: string;
  divisionId: string | null;
  publishedAt: string;
  filas: number;
}

export async function getPublications(eventId: string): Promise<PublicationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("result_publications")
    .select("id, division_id, published_at, snapshot")
    .eq("event_id", eventId)
    .order("published_at", { ascending: false });

  return (data ?? []).map((p) => ({
    id: p.id,
    divisionId: p.division_id,
    publishedAt: p.published_at,
    filas: Array.isArray(p.snapshot) ? p.snapshot.length : 0,
  }));
}
