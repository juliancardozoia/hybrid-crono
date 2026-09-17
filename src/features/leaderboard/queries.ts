import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public";
import { buildScoreboard, type ScoreboardDivisionResult, type ScoreboardInput } from "@/shared/scoring/scoreboard";
import type { Database } from "@/lib/supabase/database.types";
import type { EventFormat, LaneStatus } from "@/lib/supabase/types";

type Cliente = SupabaseClient<Database>;

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
  /** El pais de cada integrante, en el mismo orden que `athletes`. */
  countries: (string | null)[];
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
  countries: unknown;
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

/**
 * Leaderboard publico de un evento. Vacio si el evento no esta en vivo ni
 * publicado.
 *
 * Acepta un cliente OPCIONAL: por default es el anonimo (el leaderboard
 * publico se ve igual para todos, ver `createPublicClient`), pero
 * `/en-vivo/[slug]/atleta/[bib]` le pasa el cliente con sesion para que un
 * inscripto o un staff del evento desbloqueen su propio resultado sin
 * importar el plan (el gate para ESE caso vive en Postgres, en
 * `puede_ver_resultados_propios` -- ver la migracion
 * `20260921100000_resultados_propios_sin_gate.sql`).
 */
export async function getLeaderboard(
  slug: string,
  supabase: Cliente = createPublicClient(),
): Promise<Leaderboard> {
  const { data, error } = await supabase.rpc("public_leaderboard", { p_public_slug: slug });

  if (error || !data) {
    return { rows: [], divisions: [], official: false, updatedAt: Date.now() };
  }

  const rows: LeaderboardRow[] = (data as unknown as RpcRow[]).map((r) => ({
    divisionName: r.division_name,
    bib: r.bib_number,
    teamName: r.team_name,
    athletes: r.athletes ?? "",
    countries: Array.isArray(r.countries) ? (r.countries as (string | null)[]) : [],
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
  format: EventFormat;
  official: boolean;
}

/**
 * Cabecera del evento. null si el evento no es publico todavia.
 *
 * Mismo cliente opcional que `getLeaderboard`: por default el anonimo, y
 * `atleta/[bib]` le pasa el de sesion para que el propio inscripto vea el
 * evento aunque todavia no haya llegado a 'live'.
 */
export async function getEventInfo(
  slug: string,
  supabase: Cliente = createPublicClient(),
): Promise<EventInfo | null> {
  const { data, error } = await supabase.rpc("public_event_info", { p_public_slug: slug });

  const fila = (data as unknown as Array<Record<string, unknown>> | null)?.[0];
  if (error || !fila) return null;

  return {
    name: String(fila.name ?? ""),
    venue: (fila.venue as string | null) ?? null,
    eventDate: (fila.event_date as string | null) ?? null,
    format: fila.format as EventFormat,
    official: Boolean(fila.official),
  };
}

export interface TablaGeneral {
  divisiones: ScoreboardDivisionResult[];
  /** Cuantas pruebas tiene el evento en total. Con una sola, el general PUEDE no aportar. */
  cantidadDePruebas: number;
  /**
   * Si TODAS las pruebas del evento son de circuito. Con una sola prueba de
   * circuito (el caso de una carrera hibrida), el leaderboard de tiempos
   * (`getLeaderboard`, que solo lee `results`) ya muestra exactamente el mismo
   * ranking, asi que la tabla general es redundante y se esconde. Un WOD de
   * CrossFit no tiene fila en `results` -- se puntua por `workout_scores` -- asi
   * que con una sola prueba la tabla general sigue siendo la UNICA que muestra
   * algo.
   */
  soloCircuito: boolean;
  official: boolean;
  updatedAt: number;
}

const VACIA: TablaGeneral = {
  divisiones: [],
  cantidadDePruebas: 0,
  soloCircuito: false,
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
 *
 * Mismo cliente opcional que `getLeaderboard`/`getEventInfo` -- ver ahi.
 */
export async function getTablaGeneral(
  slug: string,
  supabase: Cliente = createPublicClient(),
): Promise<TablaGeneral> {
  const { data, error } = await supabase.rpc("public_scoreboard", { p_public_slug: slug });

  if (error || !data) return { ...VACIA, updatedAt: Date.now() };

  const documento = data as unknown as ScoreboardInput;
  const partes = documento.parts ?? [];

  return {
    divisiones: buildScoreboard(documento),
    cantidadDePruebas: partes.length,
    soloCircuito: partes.length > 0 && partes.every((p) => p.timeScheme === "circuito"),
    official: Boolean(documento.event?.official),
    updatedAt: Date.now(),
  };
}
