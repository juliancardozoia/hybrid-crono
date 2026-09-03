"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  requireEventAccess,
  requireManage,
} from "@/features/events/lib/access";
import { recomputeStandings } from "@/features/verification/lib/standings";
import { esLimiteDePlan } from "@/features/planes/lib/errores";
import { tiempoAMs } from "./lib/tiempo";
import type {
  BlockKind,
  CaptureMode,
  MovementUnit,
  ScoreDirDb,
  ScoreStatusDb,
  ScoreUnitDb,
  TeamMode,
  TimeScheme,
} from "@/lib/supabase/types";

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo guardar.";
  // Un limite del plan trae su propio mensaje, escrito para el organizador.
  if (esLimiteDePlan(error)) return error.message ?? "Esto es del plan Pro.";
  if (error.code === "23505")
    return "Ya existe un registro con ese nombre o ese orden.";
  if (error.code === "23503") return "Falta algo que este registro necesita.";
  if (error.code === "23514")
    return "Algún valor está fuera de rango para este tipo de prueba.";
  if (error.code === "42501") return "No tienes permiso para esta operación.";
  return error.message ?? "No se pudo guardar.";
}

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
}

function numeroOpcional(formData: FormData, campo: string): number | null {
  const bruto = String(formData.get(campo) ?? "").trim();
  if (!bruto) return null;
  const valor = Number(bruto);
  return Number.isFinite(valor) ? valor : null;
}

/** Minutos a milisegundos. La UI pide minutos porque nadie piensa en ms. */
function minutosAMs(formData: FormData, campo: string): number | null {
  const minutos = numeroOpcional(formData, campo);
  return minutos === null ? null : Math.round(minutos * 60_000);
}

// --- Pruebas ----------------------------------------------------------------

export async function crearPrueba(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const timeScheme = String(formData.get("timeScheme") ?? "cap") as TimeScheme;
  const scoreUnit = String(
    formData.get("scoreUnit") ?? "tiempo",
  ) as ScoreUnitDb;
  const scoreDir = String(
    formData.get("scoreDir") ?? "menor_gana",
  ) as ScoreDirDb;
  const teamMode = String(formData.get("teamMode") ?? "individual") as TeamMode;
  const capMinutos = minutosAMs(formData, "capMinutos");
  const ventanaMinutos = minutosAMs(formData, "ventanaMinutos");
  const intervaloSegundos = numeroOpcional(formData, "intervaloSegundos");

  await requireManage(eventId);
  if (name.length < 2) return { error: "Escribe un nombre a la prueba." };

  // Las combinaciones incoherentes las rechaza la base igual, pero un mensaje
  // que diga que falta se lee mejor que un error de constraint.
  if (timeScheme === "ventana" && !ventanaMinutos) {
    return { error: "Un AMRAP necesita la duración de la ventana." };
  }
  if (timeScheme === "intervalos" && !intervaloSegundos) {
    return {
      error: "Una prueba por intervalos necesita cuánto dura cada intervalo.",
    };
  }
  if (timeScheme === "cap" && !capMinutos) {
    return { error: "Una prueba con cap necesita el tope de tiempo." };
  }

  const supabase = await createClient();

  const { data: ultima } = await supabase
    .from("workouts")
    .select("order_index")
    .eq("event_id", eventId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: workout, error: errorWorkout } = await supabase
    .from("workouts")
    .insert({
      event_id: eventId,
      name,
      order_index: (ultima?.order_index ?? -1) + 1,
    })
    .select("id")
    .single();

  if (errorWorkout || !workout) return { error: traducir(errorWorkout) };

  const { data: parte, error: errorParte } = await supabase
    .from("workout_parts")
    .insert({
      workout_id: workout.id,
      event_id: eventId,
      order_index: 0,
      time_scheme: timeScheme,
      score_unit: scoreUnit,
      score_dir: scoreDir,
      team_mode: teamMode,
      time_cap_ms: capMinutos,
      // Quien capea rankea por reps y va siempre detras del que termino.
      cap_unit: capMinutos ? "reps" : null,
      window_ms: ventanaMinutos,
      interval_ms: intervaloSegundos ? intervaloSegundos * 1000 : null,
    })
    .select("id")
    .single();

  if (errorParte || !parte) return { error: traducir(errorParte) };

  // Toda categoria del evento queda inscripta por defecto. Sacar una es un
  // click; adivinar cuales queria el organizador, no.
  const { data: divisiones } = await supabase
    .from("divisions")
    .select("id")
    .eq("event_id", eventId);

  if (divisiones && divisiones.length > 0) {
    await supabase.from("part_divisions").insert(
      divisiones.map((d) => ({
        part_id: parte.id,
        division_id: d.id,
        event_id: eventId,
      })),
    );
  }

  refrescar(eventId);
  return OK;
}

/**
 * Cambia como se captura una prueba: a mano o juzgandola en vivo.
 *
 * La restriccion de plan NO se chequea aca. La aplica un trigger de Postgres,
 * que es lo unico que no se saltea llamando a PostgREST con la misma sesion; lo
 * que hace esta accion es devolver ese mensaje tal cual para que la pantalla lo
 * muestre.
 */
export async function cambiarModoDeCaptura(
  eventId: string,
  partId: string,
  modo: CaptureMode,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("workout_parts")
    .update({ capture_mode: modo })
    .eq("id", partId);

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

export async function borrarPrueba(
  eventId: string,
  workoutId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("workouts")
    .delete()
    .eq("id", workoutId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function alternarCategoria(
  eventId: string,
  partId: string,
  divisionId: string,
  activar: boolean,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = activar
    ? await supabase
        .from("part_divisions")
        .insert({ part_id: partId, division_id: divisionId, event_id: eventId })
    : await supabase
        .from("part_divisions")
        .delete()
        .eq("part_id", partId)
        .eq("division_id", divisionId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

// --- Estructura del WOD -----------------------------------------------------

export async function agregarBloque(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const partId = String(formData.get("partId") ?? "");
  const kind = String(formData.get("kind") ?? "trabajo") as BlockKind;
  const repeticiones = numeroOpcional(formData, "repeticiones") ?? 1;
  const duracionSegundos = numeroOpcional(formData, "duracionSegundos");
  const descansoSegundos = numeroOpcional(formData, "descansoSegundos");

  await requireManage(eventId);

  const supabase = await createClient();
  const { data: ultimo } = await supabase
    .from("part_blocks")
    .select("order_index")
    .eq("part_id", partId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("part_blocks").insert({
    part_id: partId,
    event_id: eventId,
    order_index: (ultimo?.order_index ?? -1) + 1,
    kind,
    repeticiones,
    duracion_ms: duracionSegundos ? duracionSegundos * 1000 : null,
    descanso_ms: descansoSegundos ? descansoSegundos * 1000 : null,
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

export async function borrarBloque(
  eventId: string,
  blockId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("part_blocks")
    .delete()
    .eq("id", blockId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function agregarMovimiento(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const partId = String(formData.get("partId") ?? "");
  const blockId = String(formData.get("blockId") ?? "");
  const movementId = String(formData.get("movementId") ?? "").trim();
  const customName = String(formData.get("customName") ?? "").trim();
  const unit = String(formData.get("unit") ?? "reps") as MovementUnit;
  const objetivo = String(formData.get("objetivo") ?? "").trim();
  const loadKg = numeroOpcional(formData, "loadKg");
  const maxReps = formData.get("maxReps") === "on";
  const esTiebreak = formData.get("esTiebreak") === "on";

  await requireManage(eventId);

  // "Otro" es el escape para un movimiento que no esta en el catalogo. La base
  // exige exactamente uno de los dos.
  const esOtro = movementId === "" || movementId === "otro";
  if (esOtro && customName.length < 2) {
    return { error: "Elige un movimiento del catálogo o escribe su nombre." };
  }

  // El objetivo se escribe como "21-15-9" o como un solo numero. Un arreglo es
  // lo que hace que la escalera de Fran y el ascenso de un Death By salgan sin
  // ningun campo extra.
  const targetPerRound = objetivo
    ? objetivo
        .split(/[-,\s]+/)
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0)
    : [];

  if (!maxReps && targetPerRound.length === 0) {
    return { error: 'Escribe el objetivo, por ejemplo "21-15-9" o "50".' };
  }

  const supabase = await createClient();
  const { data: ultimo } = await supabase
    .from("part_movements")
    .select("order_index")
    .eq("block_id", blockId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("part_movements").insert({
    block_id: blockId,
    part_id: partId,
    event_id: eventId,
    order_index: (ultimo?.order_index ?? -1) + 1,
    movement_id: esOtro ? null : movementId,
    custom_name: esOtro ? customName : null,
    unit,
    target_per_round: targetPerRound.length > 0 ? targetPerRound : [0],
    load_kg: loadKg,
    max_reps: maxReps,
    es_tiebreak: esTiebreak,
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

export async function borrarMovimiento(
  eventId: string,
  movementId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("part_movements")
    .delete()
    .eq("id", movementId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

// --- Carga manual de resultados ---------------------------------------------

export async function guardarScore(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const partId = String(formData.get("partId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const status = String(formData.get("status") ?? "valido") as ScoreStatusDb;
  const scoreUnit = String(
    formData.get("scoreUnit") ?? "tiempo",
  ) as ScoreUnitDb;

  const acceso = await requireEventAccess(eventId);
  if (!acceso.canVerify)
    return { error: "No tienes permiso para cargar resultados." };

  const payload: Record<string, unknown> = { status };

  if (status === "valido") {
    const valor =
      scoreUnit === "tiempo"
        ? tiempoAMs(String(formData.get("value") ?? ""))
        : numeroOpcional(formData, "value");

    if (valor === null) {
      return {
        error:
          scoreUnit === "tiempo"
            ? 'Escribe el tiempo como "12:34" o "12:34.56".'
            : "Escribe el resultado.",
      };
    }
    payload.value = valor;
    if (scoreUnit === "rondas_reps")
      payload.reps = numeroOpcional(formData, "reps") ?? 0;
  }

  if (status === "capeado") {
    const reps = numeroOpcional(formData, "capValue");
    if (reps === null)
      return { error: "Escribe cuántas repeticiones alcanzó a hacer." };
    payload.capValue = reps;
  }

  const desempate = String(formData.get("tiebreak") ?? "").trim();
  if (desempate) payload.tiebreak = tiempoAMs(desempate) ?? Number(desempate);

  const supabase = await createClient();
  const { error } = await supabase.rpc("upsert_workout_score", {
    p_part_id: partId,
    p_team_id: teamId,
    p_score: payload as never,
  });

  if (error) return { error: traducir(error) };

  // El leaderboard general se rearma con el score nuevo. Si falla, el score ya
  // quedo guardado igual: el cache se puede reconstruir, el dato no.
  void recomputeStandings(eventId).catch(() => {});

  refrescar(eventId);
  return OK;
}

export async function recalcularGeneral(eventId: string): Promise<FormState> {
  await requireEventAccess(eventId);
  const { error } = await recomputeStandings(eventId);
  if (error) return { error };

  refrescar(eventId);
  return OK;
}
