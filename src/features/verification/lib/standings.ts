import "server-only";

import { computeOverall, resolverTiebreaksDeOtraPrueba } from "@/shared/scoring/overall";
import {
  detectarFieldMismatch,
  escalarTabla,
  puntosDinamicos,
  tablaDeCategoria,
} from "@/shared/scoring/points";
import type { FieldMismatch } from "@/shared/scoring/points";
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
): Promise<{ categorias: number; error?: string; mismatches?: FieldMismatch[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { categorias: 0, error: "Sin sesion" };

  // El evento se resuelve con el cliente del USUARIO para que RLS decida si
  // puede verlo. Si no es de su organizacion no llega ninguna fila.
  const { data: evento } = await supabase
    .from("events")
    .select("id, format, status, tie_point_policy")
    .eq("id", eventId)
    .maybeSingle();

  if (!evento) return { categorias: 0, error: "Sin evento" };

  const service = createServiceClient();

  const [{ data: partes }, { data: asignaciones }, { data: equipos }, { data: divisiones }, { data: scores }] =
    await Promise.all([
      service
        .from("workout_parts")
        .select(
          "id, workout_id, order_index, score_unit, score_dir, cap_unit, max_points, tiebreak_unit, tiebreak_dir, tiebreak_source, tiebreak_part_id",
        )
        .eq("event_id", eventId),
      service
        .from("part_divisions")
        .select("part_id, division_id")
        .eq("event_id", eventId),
      service.from("teams").select("id, division_id, status").eq("event_id", eventId),
      service.from("divisions").select("id, name").eq("event_id", eventId),
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
    // Solo cuenta cuando el desempate DE VERDAD viene de otra parte: el
    // resto de los `tiebreak_source` ('hito', 'manual') ya tienen su valor en
    // el `tiebreak_value` de esta misma fila.
    tiebreakPartId: p.tiebreak_source === "otra_prueba" ? p.tiebreak_part_id : null,
  }));
  const specPorId = new Map(specs.map((s) => [s.id, s]));

  const crudosSinResolver: RawScore[] = (scores ?? []).map((s) => ({
    partId: s.part_id,
    teamId: s.team_id,
    status: s.status,
    value: s.value_num,
    reps: s.value_reps,
    capValue: s.value_cap,
    tiebreak: s.tiebreak_value,
  }));

  // Una sola pasada sobre TODO el evento: alcanza con resolverlo una vez,
  // antes de entrar al bucle por categoria.
  const crudos = resolverTiebreaksDeOtraPrueba(specs, crudosSinResolver);

  // La curva congelada de cada categoria. Null para las que todavia no la
  // generaron: ahi se calcula al vuelo con el field de hoy.
  const { data: snapshots } = await service
    .from("scoring_snapshots")
    .select("division_id, points, field_size, locked_at, tie_point_policy")
    .eq("event_id", eventId)
    .eq("stage", 1);

  const snapshotPorDivision = new Map(
    (snapshots ?? []).map((sn) => [sn.division_id, sn.points.map(Number)]),
  );
  const tiePolicyPorDivision = new Map(
    (snapshots ?? []).map((sn) => [sn.division_id, sn.tie_point_policy]),
  );
  // Solo importa el field_size de un snapshot ya CONGELADO: uno sin bloquear
  // se recalcula contra el field de hoy en tablaDeCategoria, asi que nunca
  // puede quedar desfasado -- el mismatch es exclusivo del que ya es la
  // autoridad y no puede seguir el field real.
  const snapshotBloqueadoPorDivision = new Map(
    (snapshots ?? [])
      .filter((sn) => sn.locked_at !== null)
      .map((sn) => [sn.division_id, sn.field_size]),
  );

  const pesoPorParte = new Map((partes ?? []).map((p) => [p.id, Number(p.max_points)]));

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

  // Categorias que ya calcularon con un field concreto y todavia no tienen la
  // curva congelada. Ver `congelarCurvasQueFaltan` al final.
  const congelar: Array<{ divisionId: string; fieldSize: number }> = [];
  const mismatches: FieldMismatch[] = [];

  for (const division of divisiones) {
    // Los retirados no entran al padron: con posiciones fisicas, uno al fondo
    // le corre la posicion a todos los que estan detras.
    const teamIds = (equipos ?? [])
      .filter((t) => t.division_id === division.id && t.status !== "withdrawn")
      .map((t) => t.id);

    if (teamIds.length === 0) continue;

    // Un snapshot CONGELADO que ya no describe al field real NO se puntua en
    // silencio: el clamp de pointsForPosition daria 0 a los que sobran sin
    // que nadie se entere. Se bloquea esta categoria (no se toca su cache de
    // `standings`, que puede quedar desactualizado hasta que se resuelva) y
    // se reporta el mismatch para que el organizador decida: o esos atletas
    // no van en la categoria, o el snapshot se regenera.
    const snapshotFieldSize = snapshotBloqueadoPorDivision.get(division.id);
    if (snapshotFieldSize !== undefined) {
      const mismatch = detectarFieldMismatch({
        divisionId: division.id,
        stage: 1,
        snapshotFieldSize,
        actualFieldSize: teamIds.length,
      });
      if (mismatch) {
        mismatches.push(mismatch);
        continue;
      }
    }

    const partesDeLaCategoria = (asignaciones ?? [])
      .filter((a) => a.division_id === division.id)
      .map((a) => specPorId.get(a.part_id))
      .filter((p): p is PartSpec => Boolean(p));

    if (partesDeLaCategoria.length === 0) continue;

    // La politica sale del snapshot si ya existe -- es la autoridad
    // congelada -- y del evento mientras la curva se calcula al vuelo.
    const tabla: ScoringTable = tablaDeCategoria({
      formato: evento.format,
      snapshot: snapshotPorDivision.get(division.id) ?? null,
      fieldSize: teamIds.length,
      tiePolicy: tiePolicyPorDivision.get(division.id) ?? evento.tie_point_policy,
    });

    const general = computeOverall({
      parts: partesDeLaCategoria,
      // El peso de la prueba escala la curva de la categoria. Antes esto era
      // "asignarle otra tabla a la parte"; un multiplicador dice lo mismo sin
      // poder desincronizarse de la curva.
      tableFor: (part) => escalarTabla(tabla, pesoPorParte.get(part.id) ?? 100),
      teamIds,
      scores: crudos,
    });

    congelar.push({ divisionId: division.id, fieldSize: teamIds.length });

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

  await congelarCurvasQueFaltan({
    service,
    eventId,
    formato: evento.format,
    estado: evento.status,
    yaCongeladas: new Set(snapshotPorDivision.keys()),
    candidatas: congelar,
  });

  if (mismatches.length > 0) {
    const nombrePorDivision = new Map(divisiones.map((d) => [d.id, d.name]));
    const detalle = mismatches
      .map(
        (m) =>
          `'${nombrePorDivision.get(m.divisionId) ?? m.divisionId}' tiene ${m.actualFieldSize} atletas y su tabla se congelo con ${m.snapshotFieldSize}`,
      )
      .join("; ");
    return {
      categorias: divisiones.length - mismatches.length,
      mismatches,
      error: `No se actualizo la tabla general de ${mismatches.length} categoria${mismatches.length === 1 ? "" : "s"} porque su snapshot quedo desfasado: ${detalle}. Regenera el snapshot en Puntuacion antes de publicar.`,
    };
  }

  return { categorias: divisiones.length };
}

/**
 * Red de seguridad: congela la curva de una categoria que ya esta compitiendo.
 *
 * Lo normal es que el organizador la genere y la bloquee a mano antes de
 * largar (`/panel/eventos/[id]/puntuacion`). Pero si se olvida, la curva
 * seguiria calculandose contra "los atletas que hay ahora" y el dia que
 * alguien se retire cambiarian los puntos de las pruebas YA CORRIDAS. Por eso
 * el recalculo la congela solo en cuanto la competencia arranco, con el field
 * que tiene en ese momento.
 *
 * Solo CrossFit: una carrera hibrida no reparte puntos.
 */
async function congelarCurvasQueFaltan(params: {
  service: ReturnType<typeof createServiceClient>;
  eventId: string;
  formato: string;
  estado: string;
  yaCongeladas: Set<string>;
  candidatas: Array<{ divisionId: string; fieldSize: number }>;
}): Promise<void> {
  const { service, eventId, formato, estado, yaCongeladas, candidatas } = params;

  if (formato === "carrera_hibrida") return;
  if (estado !== "live" && estado !== "verifying" && estado !== "published") return;

  const nuevas = candidatas.filter((c) => !yaCongeladas.has(c.divisionId));
  if (nuevas.length === 0) return;

  await service.from("scoring_snapshots").insert(
    nuevas.map((c) => ({
      event_id: eventId,
      division_id: c.divisionId,
      stage: 1,
      field_size: c.fieldSize,
      points: puntosDinamicos(c.fieldSize),
      locked_at: new Date().toISOString(),
    })),
  );
}
