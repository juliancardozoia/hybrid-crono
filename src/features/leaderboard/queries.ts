import { createPublicClient } from "@/lib/supabase/public";
import { buildScoreboard, type ScoreboardDivisionResult, type ScoreboardInput } from "@/shared/scoring/scoreboard";
import type { LaneStatus } from "@/lib/supabase/types";

export interface LeaderboardSplit {
  segmentName: string;
  orderIndex: number;
  cumulativeMs: number;
  durationMs: number;
}

export interface LeaderboardRow {
  divisionName: string;
  bib: number;
  teamName: string | null;
  athletes: string;
  status: LaneStatus;
  totalMs: number | null;
  penaltyMs: number;
  splits: LeaderboardSplit[];
  position: number;
  official: boolean;
}

export interface Leaderboard {
  rows: LeaderboardRow[];
  divisions: string[];
  official: boolean;
  updatedAt: number;
}

interface RpcRow {
  division_name: string;
  bib_number: number;
  team_name: string | null;
  athletes: string | null;
  status: LaneStatus;
  total_ms: number | null;
  penalty_ms: number;
  splits: unknown;
  rank_position: number;
  official: boolean;
}

function mapSplits(raw: unknown): LeaderboardSplit[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    const o = s as Record<string, unknown>;
    if (typeof o?.segmentName !== "string") return [];
    return [
      {
        segmentName: o.segmentName,
        orderIndex: Number(o.orderIndex ?? 0),
        cumulativeMs: Number(o.cumulativeMs ?? 0),
        durationMs: Number(o.durationMs ?? 0),
      },
    ];
  });
}

/** Leaderboard publico de un evento. Vacio si el evento no esta en vivo ni publicado. */
export async function getLeaderboard(slug: string): Promise<Leaderboard> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("public_leaderboard", { p_public_slug: slug });

  if (error || !data) {
    return { rows: [], divisions: [], official: false, updatedAt: Date.now() };
  }

  const rows: LeaderboardRow[] = (data as unknown as RpcRow[]).map((r) => ({
    divisionName: r.division_name,
    bib: r.bib_number,
    teamName: r.team_name,
    athletes: r.athletes ?? "",
    status: r.status,
    totalMs: r.total_ms,
    penaltyMs: r.penalty_ms,
    splits: mapSplits(r.splits),
    position: Number(r.rank_position),
    official: r.official,
  }));

  rows.sort(
    (a, b) => a.divisionName.localeCompare(b.divisionName) || a.position - b.position,
  );

  return {
    rows,
    divisions: [...new Set(rows.map((r) => r.divisionName))].sort(),
    // Oficial solo si el evento entero esta publicado. Mientras haya un heat
    // corriendo, todo lo que se muestra es provisorio.
    official: rows.length > 0 && rows.every((r) => r.official),
    updatedAt: Date.now(),
  };
}

export interface EventInfo {
  name: string;
  venue: string | null;
  eventDate: string | null;
  official: boolean;
}

/** Cabecera del evento. null si el evento no es publico todavia. */
export async function getEventInfo(slug: string): Promise<EventInfo | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("public_event_info", { p_public_slug: slug });

  const fila = (data as unknown as Array<Record<string, unknown>> | null)?.[0];
  if (error || !fila) return null;

  return {
    name: String(fila.name ?? ""),
    venue: (fila.venue as string | null) ?? null,
    eventDate: (fila.event_date as string | null) ?? null,
    official: Boolean(fila.official),
  };
}

export interface TablaGeneral {
  divisiones: ScoreboardDivisionResult[];
  /** Cuantas pruebas tiene el evento en total. Con una sola, el general no aporta. */
  cantidadDePruebas: number;
  official: boolean;
  updatedAt: number;
}

const VACIA: TablaGeneral = {
  divisiones: [],
  cantidadDePruebas: 0,
  official: false,
  updatedAt: 0,
};

/**
 * Tabla general por puntos.
 *
 * La base devuelve filas crudas y el ranking se arma aca con buildScoreboard,
 * la misma funcion pura que corre el recalculo del servidor. En el plan
 * gratuito public_scoreboard devuelve null hasta que el evento se publica: el
 * gate vive en Postgres, no en este archivo, asi que no se puede saltear
 * leyendo la respuesta.
 */
export async function getTablaGeneral(slug: string): Promise<TablaGeneral> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("public_scoreboard", { p_public_slug: slug });

  if (error || !data) return { ...VACIA, updatedAt: Date.now() };

  const documento = data as unknown as ScoreboardInput;

  return {
    divisiones: buildScoreboard(documento),
    cantidadDePruebas: documento.parts?.length ?? 0,
    official: Boolean(documento.event?.official),
    updatedAt: Date.now(),
  };
}
