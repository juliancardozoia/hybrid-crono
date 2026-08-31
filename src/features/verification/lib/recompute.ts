import "server-only";

import { reduceLaneEvents } from "@/shared/timing/reducer";
import type { Segment, TimingEvent } from "@/shared/timing/types";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Reconstruye el cache de resultados desde el log de marcajes.
 *
 * Corre `reduceLaneEvents`, LA MISMA funcion pura que usa el celular del juez
 * para pintar el tiempo en vivo. No hay una segunda implementacion del calculo
 * en SQL ni aca: si el tiempo en vivo y el oficial pudieran diferir, el producto
 * entero pierde sentido.
 *
 * `results` es cache: se puede borrar entera y reconstruirse. La unica fuente de
 * verdad es `timing_events`.
 *
 * Vive en un modulo compartido y no dentro de la ruta HTTP porque tambien lo
 * llama la torre de control. Un server action que le hiciera fetch a su propia
 * API no llevaria las cookies de sesion y recibiria un 401.
 */
export async function recomputeLanes(filtro: {
  laneId?: string;
  heatId?: string;
}): Promise<{ recalculados: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { recalculados: 0, error: "Sin sesion" };

  // Los carriles se resuelven con el cliente del USUARIO: RLS decide cuales
  // puede ver. Si no son de su organizacion no llega ninguna fila y no hay nada
  // que recalcular.
  const query = supabase.from("lanes").select("id, event_id, heat_id, team_id");
  const { data: lanes } = filtro.laneId
    ? await query.eq("id", filtro.laneId)
    : filtro.heatId
      ? await query.eq("heat_id", filtro.heatId)
      : { data: null };

  if (!lanes || lanes.length === 0) return { recalculados: 0, error: "Sin carriles" };

  // `results` solo la escribe head judge u organizacion, pero el cache tiene que
  // actualizarse tambien cuando sincroniza un juez comun. Ya verificamos arriba
  // que el carril es suyo, asi que el service role escribe en su nombre sin
  // abrirle la tabla.
  const service = createServiceClient();
  let recalculados = 0;

  for (const lane of lanes) {
    const [{ data: eventos }, { data: equipo }] = await Promise.all([
      service.from("timing_events").select("*").eq("lane_id", lane.id).order("seq"),
      lane.team_id
        ? service
            .from("teams")
            .select("division_id, divisions (course_template_id)")
            .eq("id", lane.team_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const info = equipo as {
      division_id: string;
      divisions: { course_template_id: string } | null;
    } | null;

    if (!info?.divisions?.course_template_id) continue;

    const { data: segmentRows } = await service
      .from("segments")
      .select("id, order_index, kind, name")
      .eq("course_template_id", info.divisions.course_template_id)
      .order("order_index");

    const segments: Segment[] = (segmentRows ?? []).map((s) => ({
      id: s.id,
      orderIndex: s.order_index,
      kind: s.kind,
      name: s.name,
    }));

    const log: TimingEvent[] = (eventos ?? []).map((e) => ({
      id: e.id,
      laneId: e.lane_id,
      seq: e.seq,
      type: e.type,
      segmentId: e.segment_id,
      elapsedMs: e.elapsed_ms,
      payload: (e.payload ?? {}) as Record<string, unknown>,
      recordedBy: e.recorded_by,
      deviceId: e.device_id ?? "",
      clientCapturedAt: e.client_captured_at ? new Date(e.client_captured_at).getTime() : 0,
      supersedesId: e.supersedes_id,
      voided: e.voided,
      voidReason: e.void_reason,
    }));

    const resultado = reduceLaneEvents(lane.id, log, segments);

    await service.from("results").upsert(
      {
        lane_id: lane.id,
        event_id: lane.event_id,
        heat_id: lane.heat_id,
        team_id: lane.team_id,
        division_id: info.division_id,
        // El reductor dice "not_started"; el enum de la base lo llama "idle".
        status: resultado.status === "not_started" ? "idle" : resultado.status,
        raw_ms: resultado.rawMs,
        penalty_ms: resultado.penaltyMs,
        total_ms: resultado.totalMs,
        stopped_at_ms: resultado.stoppedAtMs,
        splits: resultado.splits,
        anomalies: resultado.anomalies,
        source_event_count: log.length,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lane_id" },
    );

    recalculados += 1;
  }

  return { recalculados };
}
