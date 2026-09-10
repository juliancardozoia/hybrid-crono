import { createClient } from "@/lib/supabase/server";
import type {
  LoadUnit,
  MovementRow,
  PartBlockRow,
  PartMovementRow,
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

/**
 * Las etapas cuyo corte YA se confirmó, para al menos una categoría de este
 * evento.
 *
 * `confirmar_corte_de_etapa` escribe en `stage_advancements` en el MISMO paso
 * en que congela el corte (`etapas.ts`): no hay un estado intermedio de
 * "registrado pero sin confirmar". Por eso alcanza con mirar si existe
 * alguna fila para (evento, etapa) — no hace falta una columna de estado
 * aparte.
 *
 * La etapa 1 nunca depende de esto: es el punto de partida de cualquier
 * competencia, con o sin etapas, y no hay ningún corte que la habilite.
 */
export async function getEtapasConCorteConfirmado(eventId: string): Promise<Set<number>> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("stage_advancements")
    .select("stage")
    .eq("event_id", eventId);

  return new Set((data ?? []).map((r) => r.stage));
}

/**
 * Una prueba ENTERA: sus partes, y de cada una su estructura y sus ajustes.
 *
 * Reemplaza a `getEstructura(partId)`, que traia una parte suelta. La pantalla
 * del constructor pasó a ser la prueba completa —con la parte A al lado de la
 * B— porque "agregar la parte B" no tenia donde vivir cuando la ruta era una
 * parte: la palabra "prueba" y la palabra "parte" se usaban como sinonimos y
 * no lo son.
 *
 * Siete consultas planas y un join en memoria. Ningun embed, como el resto de
 * este archivo.
 */
export interface ParteCompleta {
  part: WorkoutPartRow;
  blocks: PartBlockRow[];
  movements: PartMovementRow[];
  /** Categorias que corren esta parte, con su cap propio si lo tiene. */
  divisiones: Array<{ divisionId: string; timeCapMs: number | null }>;
  /** Ajustes de cada categoria, por `${divisionId}|${partMovementId}`. */
  specs: Map<string, SpecDeCategoria>;
}

export interface SpecDeCategoria {
  targetPerRound: number[] | null;
  loadKg: number | null;
  loadUnit: LoadUnit;
}

export interface PruebaCompleta {
  workout: WorkoutRow;
  partes: ParteCompleta[];
}

export async function getPruebaCompleta(
  workoutId: string,
): Promise<PruebaCompleta | null> {
  const supabase = await createClient();

  const { data: workout } = await supabase
    .from("workouts")
    .select("*")
    .eq("id", workoutId)
    .maybeSingle();

  if (!workout) return null;

  const { data: parts } = await supabase
    .from("workout_parts")
    .select("*")
    .eq("workout_id", workoutId)
    .order("order_index");

  const partIds = (parts ?? []).map((p) => p.id);
  if (partIds.length === 0) return { workout, partes: [] };

  const [{ data: blocks }, { data: movements }, { data: asignadas }, { data: specs }] =
    await Promise.all([
      supabase.from("part_blocks").select("*").in("part_id", partIds).order("order_index"),
      supabase
        .from("part_movements")
        .select("*")
        .in("part_id", partIds)
        .order("order_index"),
      supabase
        .from("part_divisions")
        .select("part_id, division_id, time_cap_ms")
        .in("part_id", partIds),
      // Los ajustes se piden por EVENTO y se filtran en memoria por los
      // movimientos de esta prueba. Pedirlos por `part_movement_id` obligaria
      // a esperar la consulta de movimientos y encadenar un viaje mas, para
      // una tabla que tiene una fila por (categoria, movimiento) — nada que
      // justifique el ida y vuelta.
      supabase
        .from("division_movement_specs")
        .select("division_id, part_movement_id, target_per_round, load_kg, load_unit")
        .eq("event_id", workout.event_id),
    ]);

  const idsDeMovimientos = new Set((movements ?? []).map((m) => m.id));

  return {
    workout,
    partes: (parts ?? []).map((part) => ({
      part,
      blocks: (blocks ?? []).filter((b) => b.part_id === part.id),
      movements: (movements ?? []).filter((m) => m.part_id === part.id),
      divisiones: (asignadas ?? [])
        .filter((a) => a.part_id === part.id)
        .map((a) => ({ divisionId: a.division_id, timeCapMs: a.time_cap_ms })),
      specs: new Map(
        (specs ?? [])
          .filter((s) => idsDeMovimientos.has(s.part_movement_id))
          .map((s) => [
            `${s.division_id}|${s.part_movement_id}`,
            {
              targetPerRound: s.target_per_round,
              loadKg: s.load_kg,
              loadUnit: s.load_unit,
            },
          ]),
      ),
    })),
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
