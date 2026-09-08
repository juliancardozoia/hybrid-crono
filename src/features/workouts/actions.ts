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
import { celdasEnKilos, type CeldaDeSpec } from "./lib/pesos";
import { aKilos } from "@/shared/unidades/carga";
import type {
  BlockKind,
  CaptureMode,
  CaptureStyle,
  LoadUnit,
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

/**
 * "21-15-9" o "50" -> el arreglo de objetivos por ronda.
 *
 * Es lo que hace que la escalera de Fran y el ascenso de un Death By salgan sin
 * ningún campo extra: un valor por ronda, y longitud 1 = igual en todas.
 */
function objetivoAArreglo(bruto: string): number[] {
  if (!bruto) return [];
  return bruto
    .split(/[-,\s]+/)
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/**
 * Un AMRAP no tiene "cuántas rondas": se repiten los mismos movimientos hasta
 * que se acaba la ventana. El reductor (`shared/timing/wod.ts`) no tiene
 * concepto de "ronda infinita" — necesita un número para desplegar el plan —
 * así que acá se usa un techo generoso que ningún atleta va a alcanzar en una
 * ventana real, en vez de obligar al organizador a adivinarlo.
 */
const RONDAS_AMRAP_SIN_LIMITE = 50;

/**
 * Cuántas rondas le pone a un bloque nuevo o editado.
 *
 * Si el organizador escribió un número, ese manda siempre. Vacío solo se
 * completa solo cuando la prueba es un AMRAP (`time_scheme = 'ventana'`): ahí
 * "Rondas" no es una decisión real del organizador, así que no tiene sentido
 * pedírsela.
 */
async function repeticionesDelBloque(
  supabase: Awaited<ReturnType<typeof createClient>>,
  partId: string,
  explicitas: number | null,
): Promise<number> {
  if (explicitas !== null) return explicitas;
  const { data: parte } = await supabase
    .from("workout_parts")
    .select("time_scheme")
    .eq("id", partId)
    .maybeSingle();
  return parte?.time_scheme === "ventana" ? RONDAS_AMRAP_SIN_LIMITE : 1;
}

/**
 * El peso tal como lo escribió el organizador, convertido a la unidad canónica.
 *
 * Se guardan los DOS: los kilos —que es con lo que compara el motor— y la
 * unidad, para devolverle el número del reglamento. Quien programó "95 lb" no
 * reconoce "43,09 kg".
 */
function pesoDelFormulario(formData: FormData): {
  loadKg: number | null;
  unidad: LoadUnit;
  error?: string;
} {
  const unidad: LoadUnit =
    String(formData.get("loadUnit") ?? "kg") === "lb" ? "lb" : "kg";
  const bruto = String(formData.get("load") ?? "").trim();

  if (!bruto) return { loadKg: null, unidad };

  const n = Number(bruto.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    return { loadKg: null, unidad, error: "El peso no es válido." };
  }
  return { loadKg: aKilos(n, unidad), unidad };
}

// --- Pruebas ----------------------------------------------------------------

export async function crearPrueba(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  await requireManage(eventId);
  if (name.length < 2) return { error: "Escribe un nombre a la prueba." };

  // Los mismos campos y las mismas validaciones que `editarParte`: si
  // divergieran, una prueba creada y una editada terminarian con reglas
  // distintas para el mismo esquema.
  const campos = camposDeParte(formData);
  const falta = faltaAlgoEnLaParte(campos);
  if (falta) return { error: falta };

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
      ...campos,
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
 * Cambia como se capturan TODAS las pruebas de la competencia: a mano o
 * juzgandolas en vivo.
 *
 * Es una decision de la COMPETENCIA ENTERA, no de un WOD suelto — juzgar en
 * vivo es una capacidad que se contrata para todo el evento, asi que un
 * control por prueba invitaba a una mezcla que no tiene sentido comercial
 * (la mitad en vivo, la mitad a mano, en la misma competencia). Por eso
 * actualiza TODAS las partes no-circuito de una sola vez, en vez de pedir el
 * `partId`. El circuito queda afuera: ya esta exento del gate de plan y
 * siempre se juzga en vivo en los dos planes.
 *
 * La restriccion de plan NO se chequea aca. La aplica un trigger de Postgres,
 * que es lo unico que no se saltea llamando a PostgREST con la misma sesion; lo
 * que hace esta accion es devolver ese mensaje tal cual para que la pantalla lo
 * muestre.
 */
export async function cambiarModoDeCapturaEvento(
  eventId: string,
  modo: CaptureMode,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("workout_parts")
    .update({ capture_mode: modo })
    .eq("event_id", eventId)
    .neq("time_scheme", "circuito");

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

/**
 * Publica o esconde el CONTENIDO de una prueba en la ficha pública.
 *
 * `workouts.released_at` existe desde el catálogo público (fase 9) y **no la
 * escribía nadie**: un `grep` en `src/` devolvía únicamente los tipos
 * generados. Como `public_event_detail` calcula `liberado` a partir de ella, la
 * pestaña pública de pruebas mostraba "Se anuncia más adelante" para siempre,
 * en toda competencia. `PanelDeWorkouts` estaba escrito, probado, y era
 * inalcanzable.
 *
 * POR QUE EXISTE LA COLUMNA, y por qué no alcanza con publicar el evento: el
 * organizador carga los WODs con semanas de anticipación —los necesita para
 * configurar la pantalla del juez— y casi nunca quiere que se vean con esa
 * anticipación. Sin la columna habría que elegir entre configurar tarde o
 * revelar temprano.
 *
 * Se guarda el instante y no un booleano porque la columna ya es
 * `timestamptz` y `public_event_detail` compara contra `now()`: eso deja
 * programar una revelación futura escribiendo la fecha a mano, sin cambiar el
 * esquema. La pantalla, por ahora, solo ofrece "ahora" y "nunca".
 */
export async function liberarPrueba(
  eventId: string,
  workoutId: string,
  liberar: boolean,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("workouts")
    .update({ released_at: liberar ? new Date().toISOString() : null })
    .eq("id", workoutId);

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
  const repeticionesExplicitas = numeroOpcional(formData, "repeticiones");
  const duracionSegundos = numeroOpcional(formData, "duracionSegundos");
  const descansoSegundos = numeroOpcional(formData, "descansoSegundos");

  await requireManage(eventId);

  const supabase = await createClient();
  const [{ data: ultimo }, repeticiones] = await Promise.all([
    supabase
      .from("part_blocks")
      .select("order_index")
      .eq("part_id", partId)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle(),
    repeticionesDelBloque(supabase, partId, repeticionesExplicitas),
  ]);

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
  const maxReps = formData.get("maxReps") === "on";
  const esTiebreak = formData.get("esTiebreak") === "on";

  await requireManage(eventId);

  // "Otro" es el escape para un movimiento que no esta en el catalogo. La base
  // exige exactamente uno de los dos.
  const esOtro = movementId === "" || movementId === "otro";
  if (esOtro && customName.length < 2) {
    return { error: "Elige un movimiento del catálogo o escribe su nombre." };
  }

  const targetPerRound = objetivoAArreglo(objetivo);
  if (!maxReps && targetPerRound.length === 0) {
    return { error: 'Escribe el objetivo, por ejemplo "21-15-9" o "50".' };
  }

  const carga = pesoDelFormulario(formData);
  if (carga.error) return { error: carga.error };

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
    load_kg: carga.loadKg,
    load_unit: carga.unidad,
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

// --- Editar lo que ya existe ------------------------------------------------
//
// Hasta acá una prueba se podía CREAR y BORRAR y nada más: corregirle el cap
// obligaba a rehacerla entera, con sus bloques y sus movimientos.

export async function editarPrueba(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const workoutId = String(formData.get("workoutId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  // "Stage 1 con 40 -> cut -> Stage 2 con 20". La etapa es del WORKOUT, no de
  // sus partes: un WOD con parte A/B corre las dos siempre en la misma etapa.
  const stage = numeroOpcional(formData, "stage") ?? 1;

  await requireManage(eventId);
  if (name.length < 2) return { error: "Escribe un nombre a la prueba." };
  if (stage < 1) return { error: "La etapa tiene que ser 1 o mayor." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workouts")
    .update({ name, description, stage: Math.floor(stage) })
    .eq("id", workoutId);

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

/**
 * Lee del formulario los campos que definen CÓMO se mide una parte.
 *
 * Los comparten `crearPrueba` y `editarParte`: si divergieran, una prueba
 * creada y una editada terminarían con reglas distintas para el mismo esquema.
 */
function camposDeParte(formData: FormData) {
  const timeScheme = String(formData.get("timeScheme") ?? "cap") as TimeScheme;
  const capMinutos = minutosAMs(formData, "capMinutos");

  return {
    time_scheme: timeScheme,
    score_unit: String(formData.get("scoreUnit") ?? "tiempo") as ScoreUnitDb,
    score_dir: String(formData.get("scoreDir") ?? "menor_gana") as ScoreDirDb,
    team_mode: String(formData.get("teamMode") ?? "individual") as TeamMode,
    time_cap_ms: capMinutos,
    // Quien capea rankea por reps y va siempre detrás del que terminó.
    cap_unit: capMinutos ? ("reps" as ScoreUnitDb) : null,
    window_ms: minutosAMs(formData, "ventanaMinutos"),
    // Cuanto vale ganar ESTA prueba. Vacio = 100, que es lo normal: una
    // competencia donde todos los WODs pesan igual no tiene que declararlo.
    max_points: numeroOpcional(formData, "maxPoints") ?? 100,
    interval_ms: (() => {
      const s = numeroOpcional(formData, "intervaloSegundos");
      return s === null ? null : s * 1000;
    })(),
  };
}

/** Las combinaciones que la base rechaza igual, con un mensaje que se lee. */
function faltaAlgoEnLaParte(campos: ReturnType<typeof camposDeParte>): string | null {
  if (campos.time_scheme === "ventana" && !campos.window_ms) {
    return "Un AMRAP necesita la duración de la ventana.";
  }
  if (campos.time_scheme === "intervalos" && !campos.interval_ms) {
    return "Una prueba por intervalos necesita cuánto dura cada intervalo.";
  }
  if (campos.time_scheme === "cap" && !campos.time_cap_ms) {
    return "Una prueba con cap necesita el tope de tiempo.";
  }
  return null;
}

/**
 * Los cuatro `tiebreak_*` de una parte, leidos del formulario.
 *
 * La pantalla no le pregunta al organizador "hito o manual": esa distincion
 * es COMO llega el valor a `workout_scores.tiebreak_value` (el reductor lo
 * emite solo al cerrar el movimiento marcado, o el staff lo escribe a mano) y
 * no cambia nada de como se consume — `resolverTiebreaksDeOtraPrueba` solo
 * mira si hay `tiebreakPartId`. Preguntarla igual seria una pregunta sin
 * consecuencia. Lo que la pantalla SI pregunta es de donde sale el valor:
 * de esta misma prueba, o de otra.
 */
function camposDeDesempate(
  formData: FormData,
  captureMode: CaptureMode | null,
): { campos: Record<string, unknown>; error?: string } {
  const desempate = String(formData.get("tiebreak") ?? "");

  if (!desempate) {
    return {
      campos: {
        tiebreak_source: null,
        tiebreak_unit: null,
        tiebreak_dir: null,
        tiebreak_part_id: null,
      },
    };
  }

  const tiebreakUnit = String(formData.get("tiebreakUnit") ?? "").trim();
  const tiebreakDir = String(formData.get("tiebreakDir") ?? "").trim();
  if (!tiebreakUnit || !tiebreakDir) {
    return { campos: {}, error: "Elige en qué se mide el desempate y hacia dónde gana." };
  }

  if (desempate === "otra") {
    const tiebreakPartId = String(formData.get("tiebreakPartId") ?? "").trim();
    if (!tiebreakPartId) {
      return { campos: {}, error: "Elige de qué prueba sale el desempate." };
    }
    return {
      campos: {
        tiebreak_source: "otra_prueba",
        tiebreak_unit: tiebreakUnit,
        tiebreak_dir: tiebreakDir,
        tiebreak_part_id: tiebreakPartId,
      },
    };
  }

  return {
    campos: {
      // 'hito' si el juez la marca en vivo (via `es_tiebreak` en un
      // movimiento); 'manual' si el staff la escribe al cargar el resultado.
      tiebreak_source: captureMode === "en_vivo" ? "hito" : "manual",
      tiebreak_unit: tiebreakUnit,
      tiebreak_dir: tiebreakDir,
      tiebreak_part_id: null,
    },
  };
}

export async function editarParte(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const partId = String(formData.get("partId") ?? "");

  await requireManage(eventId);

  const campos = camposDeParte(formData);
  const falta = faltaAlgoEnLaParte(campos);
  if (falta) return { error: falta };

  const supabase = await createClient();

  const { data: actual } = await supabase
    .from("workout_parts")
    .select("capture_mode")
    .eq("id", partId)
    .maybeSingle();

  const { campos: camposDesempate, error: errorDesempate } = camposDeDesempate(
    formData,
    actual?.capture_mode ?? null,
  );
  if (errorDesempate) return { error: errorDesempate };

  const { error } = await supabase
    .from("workout_parts")
    .update({ ...campos, ...camposDesempate })
    .eq("id", partId);

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

/**
 * Le agrega una segunda parte a una prueba.
 *
 * Y le pone la etiqueta "A" a la que ya estaba si no tenía ninguna. Nunca se ve
 * una "Parte B" sin una "Parte A": los labels son cosméticos —`label text not
 * null default ''`— y con una sola parte la pantalla no menciona la palabra
 * "parte" en ningún lado.
 */
export async function agregarParte(
  eventId: string,
  workoutId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { data: partes } = await supabase
    .from("workout_parts")
    .select("id, order_index, label")
    .eq("workout_id", workoutId)
    .order("order_index");

  const existentes = partes ?? [];
  const siguiente = (existentes.at(-1)?.order_index ?? -1) + 1;
  // A, B, C… La tercera parte es rara pero no imposible.
  const etiqueta = String.fromCharCode(65 + siguiente);

  const { error } = await supabase.from("workout_parts").insert({
    workout_id: workoutId,
    event_id: eventId,
    order_index: siguiente,
    label: etiqueta,
    // Una parte nueva arranca por tiempo libre: es el esquema que menos datos
    // pide, y el organizador la configura enseguida.
    time_scheme: "libre",
    score_unit: "tiempo",
    score_dir: "menor_gana",
  });

  if (error) return { error: traducir(error) };

  const primera = existentes[0];
  if (primera && primera.label === "") {
    await supabase
      .from("workout_parts")
      .update({ label: "A" })
      .eq("id", primera.id);
  }

  refrescar(eventId);
  return OK;
}

/** Borra una parte y, si queda una sola, le saca la etiqueta. */
export async function borrarParte(
  eventId: string,
  workoutId: string,
  partId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = await supabase.from("workout_parts").delete().eq("id", partId);
  if (error) return { error: traducir(error) };

  const { data: quedan } = await supabase
    .from("workout_parts")
    .select("id")
    .eq("workout_id", workoutId);

  // Una prueba que tuvo dos partes cinco minutos no puede quedar etiquetada
  // "A" para siempre.
  if (quedan?.length === 1) {
    await supabase.from("workout_parts").update({ label: "" }).eq("id", quedan[0].id);
  }

  refrescar(eventId);
  return OK;
}

export async function editarBloque(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const blockId = String(formData.get("blockId") ?? "");
  const repeticionesExplicitas = numeroOpcional(formData, "repeticiones");
  const duracionSegundos = numeroOpcional(formData, "duracionSegundos");
  const descansoSegundos = numeroOpcional(formData, "descansoSegundos");

  await requireManage(eventId);

  const supabase = await createClient();

  // Solo se consulta la prueba si hace falta: en la practica el formulario
  // siempre manda un numero (viene precargado), asi que esto rara vez corre.
  let repeticiones = repeticionesExplicitas;
  if (repeticiones === null) {
    const { data: bloqueActual } = await supabase
      .from("part_blocks")
      .select("part_id")
      .eq("id", blockId)
      .maybeSingle();
    repeticiones = bloqueActual
      ? await repeticionesDelBloque(supabase, bloqueActual.part_id, null)
      : 1;
  }

  const { error } = await supabase
    .from("part_blocks")
    .update({
      kind: String(formData.get("kind") ?? "trabajo") as BlockKind,
      label: String(formData.get("label") ?? "").trim() || null,
      repeticiones,
      duracion_ms: duracionSegundos ? duracionSegundos * 1000 : null,
      descanso_ms: descansoSegundos ? descansoSegundos * 1000 : null,
    })
    .eq("id", blockId);

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

export async function editarMovimiento(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const movementId = String(formData.get("movimientoId") ?? "");
  const objetivo = String(formData.get("objetivo") ?? "").trim();
  const maxReps = formData.get("maxReps") === "on";

  await requireManage(eventId);

  const targetPerRound = objetivoAArreglo(objetivo);
  if (!maxReps && targetPerRound.length === 0) {
    return { error: 'Escribe el objetivo, por ejemplo "21-15-9" o "50".' };
  }

  const carga = pesoDelFormulario(formData);
  if (carga.error) return { error: carga.error };

  // Vacío = "el derivado", que es lo que significa null en la columna. No es
  // lo mismo que elegir "tap".
  const captura = String(formData.get("captureStyle") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase
    .from("part_movements")
    .update({
      unit: String(formData.get("unit") ?? "reps") as MovementUnit,
      target_per_round: targetPerRound.length > 0 ? targetPerRound : [0],
      load_kg: carga.loadKg,
      load_unit: carga.unidad,
      max_reps: maxReps,
      es_tiebreak: formData.get("esTiebreak") === "on",
      capture_style: captura ? (captura as CaptureStyle) : null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", movementId);

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

// --- Reordenar --------------------------------------------------------------
//
// Las tres pasan por una funcion de Postgres y no por N updates: `unique
// (padre, order_index)` hace que cualquier intercambio choque a mitad de
// camino, y supabase-js no tiene transacciones.

export async function reordenarPruebas(
  eventId: string,
  ordenados: string[],
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_workouts", {
    p_event_id: eventId,
    p_ordered_ids: ordenados,
  });
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function reordenarBloques(
  eventId: string,
  partId: string,
  ordenados: string[],
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_part_blocks", {
    p_part_id: partId,
    p_ordered_ids: ordenados,
  });
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

export async function reordenarMovimientos(
  eventId: string,
  blockId: string,
  ordenados: string[],
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_part_movements", {
    p_block_id: blockId,
    p_ordered_ids: ordenados,
  });
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

// --- Lo que cambia por categoría --------------------------------------------

/**
 * Los pesos y las cantidades de TODAS las categorías, en una sola escritura.
 *
 * La pantalla manda la grilla entera y la función de Postgres la reemplaza
 * completa: lo que no viene es lo que el organizador borró. Una celda vacía
 * borra el ajuste y vuelve al valor base del movimiento — guardarla como cero
 * diría "cero kilos", que es otra cosa.
 */
export async function guardarSpecs(
  eventId: string,
  partId: string,
  celdas: CeldaDeSpec[],
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = await supabase.rpc("guardar_specs_de_parte", {
    p_part_id: partId,
    p_specs: celdasEnKilos(celdas) as never,
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

/**
 * El tope de tiempo de una categoría en una parte.
 *
 * Va directo a `part_divisions` —tiene RLS y GRANTs— porque es una fila por
 * categoría y no hay nada que pueda quedar a medias.
 */
export async function guardarCapPorCategoria(
  eventId: string,
  partId: string,
  divisionId: string,
  capMinutos: number | null,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { error } = await supabase
    .from("part_divisions")
    .update({ time_cap_ms: capMinutos === null ? null : Math.round(capMinutos * 60_000) })
    .eq("part_id", partId)
    .eq("division_id", divisionId);

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
