import type { SupabaseClient } from "@supabase/supabase-js";
import { createPublicClient } from "@/lib/supabase/public";
import { buildScoreboard, type ScoreboardDivisionResult, type ScoreboardInput } from "@/shared/scoring/scoreboard";
import { tablaDeDivision, type FilaDeEquipo, type TablaDeDivision } from "./lib/tabla";
import type { SegmentoDeCircuito } from "./lib/circuito";
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

/**
 * El resultado de UN atleta puntual, sea cual sea el formato de la
 * competencia. Nace de `/en-vivo/[slug]/atleta/[bib]` (esa pantalla armaba
 * esto mismo a mano, buscando la fila del dorsal despues de traer TODO el
 * evento) y se extrae aca para que el widget de "mis resultados" del panel
 * pueda mostrar lo mismo sin reimplementar "que cuenta como la fila de este
 * atleta" en un segundo lugar -- si cada pantalla lo resolviera por su
 * cuenta, un dia podrian divergir en cual toman como la fila vigente de un
 * equipo con corte de por medio.
 *
 * `null` es "sin resultados todavia" (el evento no es publico, el dorsal no
 * existe, o todavia no hay ninguna fila cargada para el) -- el llamador
 * decide que mostrar en ese caso, esta funcion no dictamina un mensaje.
 */
export type ResultadoDeAtleta =
  | {
      format: "crossfit";
      eventName: string;
      official: boolean;
      tabla: TablaDeDivision;
      fila: FilaDeEquipo;
    }
  | {
      format: "circuito";
      eventName: string;
      official: boolean;
      row: LeaderboardRow;
      rivales: LeaderboardRow[];
    }
  | null;

export async function getResultadoDeAtleta(
  slug: string,
  bib: number,
  supabase: Cliente = createPublicClient(),
): Promise<ResultadoDeAtleta> {
  const info = await getEventInfo(slug, supabase);
  if (!info) return null;

  if (info.format === "crossfit") {
    const datos = await getTablaGeneral(slug, supabase);
    const entradaDelEquipo = datos.divisiones
      .flatMap((d) => d.entries)
      .find((e) => e.team.bib === bib);
    const tabla = entradaDelEquipo ? tablaDeDivision(datos, entradaDelEquipo.team.divisionId) : null;
    const fila = tabla?.filas.find((f) => f.teamId === entradaDelEquipo?.teamId);

    if (!tabla || !fila) return null;
    return { format: "crossfit", eventName: info.name, official: datos.official, tabla, fila };
  }

  const leaderboard = await getLeaderboard(slug, supabase);
  const row = leaderboard.rows.find((r) => r.bib === bib);
  if (!row) return null;

  const rivales = leaderboard.rows.filter((r) => r.divisionName === row.divisionName);
  return {
    format: "circuito",
    eventName: info.name,
    official: leaderboard.official,
    row,
    rivales,
  };
}

/**
 * La estructura del circuito de cada categoria, y cuando largo cada equipo.
 *
 * Es lo que le falta al leaderboard para poder decir EN QUE ESTACION esta un
 * atleta: `public_leaderboard` devuelve solo los parciales ya cerrados, y la
 * estacion en curso es el primer segmento que todavia no tiene ninguno. Sin la
 * lista completa de segmentos no hay con que compararlos.
 *
 * NO es publica: la consulta el panel del organizador con el cliente de la
 * sesion y RLS decide. El publico no la necesita —su leaderboard muestra el
 * resultado, no la produccion del evento— y abrirla seria superficie nueva por
 * nada.
 *
 * Consultas PLANAS, sin ningun embed, a proposito: los embeds de PostgREST no
 * los cubren los tests de base (PGlite no tiene PostgREST) y un embed invalido
 * devuelve una pantalla vacia sin ningun error. Cruzar cinco listas cortas en
 * TypeScript no tiene ese riesgo.
 */
export interface CircuitosDelEvento {
  /** Los segmentos de cada categoria, por NOMBRE: es como vienen las filas del leaderboard. */
  porCategoria: Record<string, SegmentoDeCircuito[]>;
  /**
   * Epoch en milisegundos de la largada del heat de cada dorsal, o null si su
   * heat todavia no arranco. Es el ancla del indicador en vivo.
   */
  largadaPorDorsal: Record<number, number | null>;
  /**
   * El box de cada dorsal (varios integrantes de gimnasios distintos se unen
   * con " / "), o null si nadie lo cargo. `public_leaderboard` no lo devuelve
   * y no hace falta abrirselo al publico: el box lo lee solo el organizador.
   */
  boxPorDorsal: Record<number, string | null>;
}

export async function getCircuitosDelEvento(
  eventId: string,
  supabase: Cliente,
): Promise<CircuitosDelEvento> {
  const [divisiones, segmentos, resultados, heats, equipos, integrantes, atletas] =
    await Promise.all([
    supabase.from("divisions").select("id, name, course_template_id").eq("event_id", eventId),
    supabase
      .from("segments")
      .select("id, name, kind, order_index, course_template_id")
      .eq("event_id", eventId)
      .order("order_index"),
    supabase.from("results").select("team_id, heat_id").eq("event_id", eventId),
    supabase.from("heats").select("id, started_at").eq("event_id", eventId),
    supabase.from("teams").select("id, bib_number").eq("event_id", eventId),
    supabase.from("team_members").select("team_id, athlete_id").eq("event_id", eventId),
    supabase.from("athletes").select("id, box").eq("event_id", eventId),
  ]);

  const porPlantilla = new Map<string, SegmentoDeCircuito[]>();
  for (const s of segmentos.data ?? []) {
    const lista = porPlantilla.get(s.course_template_id) ?? [];
    lista.push({ id: s.id, name: s.name, kind: s.kind, orderIndex: s.order_index });
    porPlantilla.set(s.course_template_id, lista);
  }

  const porCategoria: Record<string, SegmentoDeCircuito[]> = {};
  for (const d of divisiones.data ?? []) {
    // `divisions.course_template_id` y NO `part_divisions.course_template_id`:
    // los splits que se van a cruzar contra esta lista los genero el recalculo
    // (`recompute.ts`), que resuelve el circuito por ahi. Tomarlo de otro lado
    // daria dos listas de estaciones que pueden no coincidir, y el atleta
    // apareceria en una estacion que no es.
    const segs = d.course_template_id ? porPlantilla.get(d.course_template_id) : undefined;
    if (segs?.length) porCategoria[d.name] = segs;
  }

  const largadaDelHeat = new Map<string, number | null>(
    (heats.data ?? []).map((h) => [h.id, h.started_at ? new Date(h.started_at).getTime() : null]),
  );
  const dorsalDelEquipo = new Map((equipos.data ?? []).map((t) => [t.id, t.bib_number]));

  const largadaPorDorsal: Record<number, number | null> = {};
  for (const r of resultados.data ?? []) {
    const dorsal = r.team_id ? dorsalDelEquipo.get(r.team_id) : undefined;
    if (dorsal == null) continue;
    largadaPorDorsal[dorsal] = largadaDelHeat.get(r.heat_id) ?? null;
  }

  const boxDelAtleta = new Map((atletas.data ?? []).map((a) => [a.id, a.box?.trim() || null]));
  const boxesDelEquipo = new Map<string, string[]>();
  for (const m of integrantes.data ?? []) {
    const box = boxDelAtleta.get(m.athlete_id);
    if (!box) continue;
    const lista = boxesDelEquipo.get(m.team_id) ?? [];
    if (!lista.includes(box)) lista.push(box);
    boxesDelEquipo.set(m.team_id, lista);
  }

  const boxPorDorsal: Record<number, string | null> = {};
  for (const t of equipos.data ?? []) {
    const boxes = boxesDelEquipo.get(t.id);
    boxPorDorsal[t.bib_number] = boxes?.length ? boxes.join(" / ") : null;
  }

  return { porCategoria, largadaPorDorsal, boxPorDorsal };
}
