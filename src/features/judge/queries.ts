import { createClient } from "@/lib/supabase/server";
import type { LaneStatus } from "@/lib/supabase/types";

export interface JudgeLane {
  laneId: string;
  laneNumber: number;
  status: LaneStatus;
  bib: number | null;
  athletes: string;
  divisionName: string;
  heatId: string;
  heatName: string;
  heatStartedAt: string | null;
  eventId: string;
  eventName: string;
  judgeId: string | null;
  /** true si lo tomo otro juez. */
  tomadoPorOtro: boolean;
}

// El estado del evento se pide a traves de `heats`, no con un embed directo
// `events (...)`: `lanes` NO tiene clave foranea a `events`, solo llega por las
// compuestas hacia heats y teams. PostgREST rechaza el embed directo con
// PGRST200 y la consulta entera devuelve cero filas.
const SELECT = `
  id, lane_number, status, judge_id, event_id, team_id,
  heats (id, name, started_at, events (name, status)),
  teams (
    bib_number, name,
    divisions (name),
    team_members (athletes (first_name, last_name))
  )
`;

interface Row {
  id: string;
  lane_number: number;
  status: LaneStatus;
  judge_id: string | null;
  event_id: string;
  team_id: string | null;
  heats: {
    id: string;
    name: string;
    started_at: string | null;
    events: { name: string; status: string } | null;
  } | null;
  teams: {
    bib_number: number;
    name: string | null;
    divisions: { name: string } | null;
    team_members: Array<{ athletes: { first_name: string; last_name: string } | null }>;
  } | null;
}

function mapear(row: Row, userId: string): JudgeLane {
  const athletes =
    row.teams?.team_members
      .flatMap((m) => (m.athletes ? [`${m.athletes.first_name} ${m.athletes.last_name}`] : []))
      .join(" / ") ?? "";

  return {
    laneId: row.id,
    laneNumber: row.lane_number,
    status: row.status,
    bib: row.teams?.bib_number ?? null,
    athletes: athletes || (row.teams?.name ?? "Sin atleta"),
    divisionName: row.teams?.divisions?.name ?? "",
    heatId: row.heats?.id ?? "",
    heatName: row.heats?.name ?? "",
    heatStartedAt: row.heats?.started_at ?? null,
    eventId: row.event_id,
    eventName: row.heats?.events?.name ?? "",
    judgeId: row.judge_id,
    tomadoPorOtro: row.judge_id !== null && row.judge_id !== userId,
  };
}

/**
 * Carriles visibles para el juez: los suyos primero, despues los libres.
 *
 * RLS ya limita a los eventos de sus organizaciones, asi que no hace falta
 * filtrar por evento aca.
 */
export interface LanesResult {
  mios: JudgeLane[];
  libres: JudgeLane[];
  /**
   * Por que no hay nada para mostrar. Sin esto la pantalla decia "no hay
   * carriles disponibles" y el organizador no tenia forma de saber que le
   * faltaba poner la competencia en vivo.
   */
  motivo:
    | null
    | "sin-organizacion"
    | "sin-eventos"
    | "eventos-en-borrador"
    | "sin-carriles"
    | "carriles-sin-atleta"
    | "todos-tomados";
}

export async function getJudgeLanes(): Promise<LanesResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { mios: [], libres: [], motivo: "sin-organizacion" };

  // Se traen TODOS los carriles, incluso los que no tienen equipo, para poder
  // distinguir "no armaste los heats" de "los armaste pero sin atletas".
  const [{ data }, { count: eventosTotales }] = await Promise.all([
    supabase.from("lanes").select(SELECT).order("lane_number"),
    supabase.from("events").select("id", { count: "exact", head: true }),
  ]);

  if (!data) {
    return {
      mios: [],
      libres: [],
      motivo: (eventosTotales ?? 0) === 0 ? "sin-eventos" : "sin-carriles",
    };
  }

  const filas = data as unknown as Row[];

  // Un evento en borrador todavia se esta configurando: mostrarlo solo
  // confundiria al juez con carriles que pueden cambiar.
  const enJuego = filas.filter(
    (r) => r.heats?.events?.status === "ready" || r.heats?.events?.status === "live",
  );
  const conAtleta = enJuego.filter((r) => r.team_id !== null);
  const todos = conAtleta.map((r) => mapear(r, user.id));

  const mios = todos.filter((l) => l.judgeId === user.id);
  const libres = todos.filter((l) => l.judgeId === null);

  let motivo: LanesResult["motivo"] = null;
  if (mios.length === 0 && libres.length === 0) {
    if ((eventosTotales ?? 0) === 0) motivo = "sin-eventos";
    else if (enJuego.length === 0 && filas.length === 0) motivo = "sin-carriles";
    else if (enJuego.length === 0) motivo = "eventos-en-borrador";
    else if (conAtleta.length === 0) motivo = "carriles-sin-atleta";
    else motivo = "todos-tomados";
  }

  return { mios, libres, motivo };
}
