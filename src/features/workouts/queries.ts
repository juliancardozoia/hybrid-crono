import { createClient } from "@/lib/supabase/server";
import type {
  MovementRow,
  PartBlockRow,
  PartMovementRow,
  ScoringTableRow,
  WorkoutPartRow,
  WorkoutRow,
  WorkoutScoreRow,
} from "@/lib/supabase/types";

/**
 * Lecturas del modelo de pruebas.
 *
 * Ninguna usa embeds de PostgREST a proposito. Los embeds los resuelve PostgREST
 * leyendo las claves foraneas, y un embed invalido pasa los tests de PGlite y
 * devuelve la pantalla vacia en produccion sin mostrar ningun error. Con varias
 * consultas sueltas y un join en memoria no hay nada que pueda fallar en
 * silencio.
 */

export interface PruebaConPartes {
  workout: WorkoutRow;
  parts: WorkoutPartRow[];
}

export async function getPruebas(eventId: string): Promise<PruebaConPartes[]> {
  const supabase = await createClient();

  const [{ data: workouts }, { data: parts }] = await Promise.all([
    supabase.from("workouts").select("*").eq("event_id", eventId).order("order_index"),
    supabase.from("workout_parts").select("*").eq("event_id", eventId).order("order_index"),
  ]);

  return (workouts ?? []).map((workout) => ({
    workout,
    parts: (parts ?? []).filter((p) => p.workout_id === workout.id),
  }));
}

export interface EstructuraDeParte {
  part: WorkoutPartRow;
  blocks: PartBlockRow[];
  movements: PartMovementRow[];
  divisionIds: string[];
}

export async function getEstructura(partId: string): Promise<EstructuraDeParte | null> {
  const supabase = await createClient();

  const { data: part } = await supabase
    .from("workout_parts")
    .select("*")
    .eq("id", partId)
    .maybeSingle();

  if (!part) return null;

  const [{ data: blocks }, { data: movements }, { data: asignadas }] = await Promise.all([
    supabase.from("part_blocks").select("*").eq("part_id", partId).order("order_index"),
    supabase.from("part_movements").select("*").eq("part_id", partId).order("order_index"),
    supabase.from("part_divisions").select("division_id").eq("part_id", partId),
  ]);

  return {
    part,
    blocks: blocks ?? [],
    movements: movements ?? [],
    divisionIds: (asignadas ?? []).map((a) => a.division_id),
  };
}

export async function getCatalogoDeMovimientos(): Promise<MovementRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("movements")
    .select("*")
    .eq("active", true)
    .order("category")
    .order("name");
  return data ?? [];
}

export async function getTablasDePuntos(): Promise<ScoringTableRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("scoring_tables").select("*").order("name");
  return data ?? [];
}

export interface FilaDeCarga {
  teamId: string;
  bib: number;
  nombre: string;
  divisionId: string;
  divisionName: string;
  score: WorkoutScoreRow | null;
}

/**
 * El padron que corre una prueba, con lo que ya se le cargo a cada uno.
 *
 * Devuelve a TODOS los que la corren, tengan score o no: la pregunta que la
 * pantalla tiene que contestar es "a quien le falta".
 */
export async function getGrillaDeCarga(
  eventId: string,
  partId: string,
): Promise<FilaDeCarga[]> {
  const supabase = await createClient();

  const { data: asignadas } = await supabase
    .from("part_divisions")
    .select("division_id")
    .eq("part_id", partId);

  const divisionIds = (asignadas ?? []).map((a) => a.division_id);
  if (divisionIds.length === 0) return [];

  const [{ data: divisiones }, { data: equipos }, { data: scores }] = await Promise.all([
    supabase.from("divisions").select("id, name").eq("event_id", eventId),
    supabase
      .from("teams")
      .select("id, bib_number, name, division_id, status")
      .eq("event_id", eventId)
      .in("division_id", divisionIds)
      .order("bib_number"),
    supabase.from("workout_scores").select("*").eq("part_id", partId),
  ]);

  const nombreDeDivision = new Map((divisiones ?? []).map((d) => [d.id, d.name]));
  const scorePorEquipo = new Map((scores ?? []).map((s) => [s.team_id, s]));

  // Los integrantes se resuelven en una sola consulta y se arman en memoria: un
  // embed anidado aca seria la cuarta consulta que hay que registrar en
  // verify-queries.mjs, y no aporta nada.
  const teamIds = (equipos ?? []).map((t) => t.id);
  const { data: integrantes } = teamIds.length
    ? await supabase
        .from("team_members")
        .select("team_id, athletes (first_name, last_name)")
        .in("team_id", teamIds)
    : { data: [] };

  const nombresPorEquipo = new Map<string, string[]>();
  for (const fila of (integrantes ?? []) as Array<{
    team_id: string;
    athletes: { first_name: string; last_name: string } | null;
  }>) {
    if (!fila.athletes) continue;
    const lista = nombresPorEquipo.get(fila.team_id) ?? [];
    lista.push(`${fila.athletes.first_name} ${fila.athletes.last_name}`);
    nombresPorEquipo.set(fila.team_id, lista);
  }

  return (equipos ?? [])
    .filter((t) => t.status !== "withdrawn")
    .map((t) => ({
      teamId: t.id,
      bib: t.bib_number,
      nombre: t.name ?? (nombresPorEquipo.get(t.id) ?? []).join(" / ") ?? "",
      divisionId: t.division_id,
      divisionName: nombreDeDivision.get(t.division_id) ?? "",
      score: scorePorEquipo.get(t.id) ?? null,
    }));
}
