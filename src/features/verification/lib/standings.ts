import "server-only";

import { computeOverall } from "@/shared/scoring/overall";
import { resolverTabla } from "@/shared/scoring/points";
import type { PartSpec, RawScore, ScoringTable } from "@/shared/scoring/types";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

/**
 * Reconstruye el cache de la tabla general desde los scores.
 *
 * Corre `computeOverall`, LA MISMA funcion pura que usa el navegador para
 * pintar el leaderboard. Igual que con los tiempos, no hay una segunda
 * implementacion del calculo en SQL: el ranking, los puntos y el desempate no
 * existen en Postgres.
 *
 * Y ademas de doctrina hay una razon tecnica: el desempate del reglamento
 * compara los puestos de cada equipo ordenados de mejor a peor, elemento por
 * elemento. Eso no es una window function, asi que la posicion se calcula aca y
 * se guarda. `standings` es cache: se puede borrar entera y reconstruirse desde
 * `workout_scores`.
 */
export async function recomputeStandings(
  eventId: string,
): Promise<{ categorias: number; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { categorias: 0, error: "Sin sesion" };

  // El evento se resuelve con el cliente del USUARIO para que RLS decida si
  // puede verlo. Si no es de su organizacion no llega ninguna fila.
  const { data: evento } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .maybeSingle();

  if (!evento) return { categorias: 0, error: "Sin evento" };

  const service = createServiceClient();

  const [{ data: partes }, { data: asignaciones }, { data: equipos }, { data: divisiones }, { data: scores }] =
    await Promise.all([
      service
        .from("workout_parts")
        .select(
          "id, workout_id, order_index, score_unit, score_dir, cap_unit, tiebreak_unit, tiebreak_dir",
        )
        .eq("event_id", eventId),
      service.from("part_divisions").select("part_id, division_id").eq("event_id", eventId),
      service.from("teams").select("id, division_id, status").eq("event_id", eventId),
      service.from("divisions").select("id, name, scoring_table_id").eq("event_id", eventId),
      service
        .from("workout_scores")
        .select("part_id, team_id, status, value_num, value_reps, value_cap, tiebreak_value")
        .eq("event_id", eventId),
    ]);

  if (!divisiones || divisiones.length === 0) return { categorias: 0 };

  // El orden global de las pruebas depende del orden de su workout, y ese dato
  // no esta en workout_parts. Se resuelve aparte para no meter un embed.
  const { data: pruebas } = await service
    .from("workouts")
    .select("id, order_index")
    .eq("event_id", eventId);
  const ordenDePrueba = new Map((pruebas ?? []).map((w) => [w.id, w.order_index]));

  const specs: PartSpec[] = (partes ?? []).map((p) => ({
    id: p.id,
    orderIndex: (ordenDePrueba.get(p.workout_id) ?? 0) * 1000 + p.order_index,
    scoreUnit: p.score_unit,
    scoreDir: p.score_dir,
    capUnit: p.cap_unit,
    tiebreakUnit: p.tiebreak_unit,
    tiebreakDir: p.tiebreak_dir,
  }));
  const specPorId = new Map(specs.map((s) => [s.id, s]));

  const crudos: RawScore[] = (scores ?? []).map((s) => ({
    partId: s.part_id,
    teamId: s.team_id,
    status: s.status,
    value: s.value_num,
    reps: s.value_reps,
    capValue: s.value_cap,
    tiebreak: s.tiebreak_value,
  }));

  // Las tablas de puntos se resuelven una vez: la clave viene de la base, los
  // valores del codigo.
  const { data: tablas } = await service
    .from("scoring_tables")
    .select("id, name, builtin_key, points");
  const tablaPorId = new Map(
    (tablas ?? []).map((t) => [t.id, resolverTabla(t.builtin_key, t.points, t.name)]),
  );

  const filas: Array<{
    event_id: string;
    division_id: string;
    team_id: string;
    position: number;
    tied_with: number;
    total_points: number;
    per_part: Json;
    tiebreak_vector: number[];
    updated_at: string;
  }> = [];

  const ahora = new Date().toISOString();

  for (const division of divisiones) {
    // Los retirados no entran al padron: con posiciones fisicas, uno al fondo
    // le corre la posicion a todos los que estan detras.
    const teamIds = (equipos ?? [])
      .filter((t) => t.division_id === division.id && t.status !== "withdrawn")
      .map((t) => t.id);

    if (teamIds.length === 0) continue;

    const partesDeLaCategoria = (asignaciones ?? [])
      .filter((a) => a.division_id === division.id)
      .map((a) => specPorId.get(a.part_id))
      .filter((p): p is PartSpec => Boolean(p));

    if (partesDeLaCategoria.length === 0) continue;

    const tabla: ScoringTable =
      tablaPorId.get(division.scoring_table_id ?? "") ?? resolverTabla(null, null, division.name);

    const general = computeOverall({
      parts: partesDeLaCategoria,
      tableFor: () => tabla,
      teamIds,
      scores: crudos,
    });

    for (const entrada of general) {
      filas.push({
        event_id: eventId,
        division_id: division.id,
        team_id: entrada.teamId,
        position: entrada.position,
        tied_with: entrada.tiedWith,
        total_points: entrada.totalPoints,
        per_part: entrada.placements as unknown as Json,
        tiebreak_vector: entrada.tiebreakVector,
        updated_at: ahora,
      });
    }
  }

  if (filas.length > 0) {
    await service.from("standings").upsert(filas, { onConflict: "division_id,team_id" });
  }

  // Un equipo que se retira despues de haber sido rankeado tiene que salir de
  // la tabla, no quedar congelado en su ultimo puesto.
  //
  // Se calcula la diferencia en memoria en vez de mandar un `not in` con todos
  // los ids: con cuatrocientos equipos ese filtro es una URL de quince mil
  // caracteres, y normalmente no sobra ninguno.
  const vigentes = new Set(filas.map((f) => f.team_id));
  const { data: guardados } = await service
    .from("standings")
    .select("team_id")
    .eq("event_id", eventId);

  const sobrantes = (guardados ?? [])
    .map((f) => f.team_id)
    .filter((teamId) => !vigentes.has(teamId));

  if (sobrantes.length > 0) {
    await service.from("standings").delete().eq("event_id", eventId).in("team_id", sobrantes);
  }

  return { categorias: divisiones.length };
}
