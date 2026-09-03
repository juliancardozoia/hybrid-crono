"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManage } from "@/features/events/lib/access";
import { instanteEnZona } from "@/shared/utils/fecha";
import type { EventStaffRole } from "@/lib/supabase/types";

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo guardar.";
  if (error.code === "23505") return "Ya existe algo con ese nombre.";
  if (error.code === "23514") return "Algún valor está fuera de rango.";
  if (error.code === "42501") return "No tienes permiso para esta operación.";
  return error.message || "No se pudo guardar.";
}

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
}

// --- Arenas -----------------------------------------------------------------

export async function crearArena(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const minutos = Number(formData.get("duracion") ?? 15);

  await requireManage(eventId);
  if (name.length < 2) return { error: "Escribe un nombre a la arena." };
  if (!Number.isInteger(minutos) || minutos < 1 || minutos > 600) {
    return { error: "La duración va entre 1 y 600 minutos." };
  }

  const supabase = await createClient();
  const { data: ultima } = await supabase
    .from("arenas")
    .select("order_index")
    .eq("event_id", eventId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("arenas").insert({
    event_id: eventId,
    name,
    order_index: (ultima?.order_index ?? -1) + 1,
    default_heat_minutes: minutos,
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

export async function borrarArena(
  eventId: string,
  arenaId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  // Los heats que la usaban quedan sin arena, no se borran.
  const { error } = await supabase.from("arenas").delete().eq("id", arenaId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

/**
 * Programa un heat: arena, hora de inicio y hora de fin.
 *
 * Las horas llegan como hora de PARED del evento. Guardarlas como si fueran UTC
 * correría el cronograma varias horas — el mismo error que ya mordió en la
 * torre de control.
 */
export async function programarHeat(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const heatId = String(formData.get("heatId") ?? "");
  const arenaId = String(formData.get("arenaId") ?? "").trim() || null;
  const inicio = String(formData.get("inicio") ?? "").trim();
  const fin = String(formData.get("fin") ?? "").trim();

  await requireManage(eventId);

  const supabase = await createClient();
  const { data: evento } = await supabase
    .from("events")
    .select("timezone")
    .eq("id", eventId)
    .maybeSingle();

  const zona = evento?.timezone ?? "America/Bogota";

  const scheduledAt = inicio ? instanteEnZona(inicio, zona) : null;
  const scheduledEnd = fin ? instanteEnZona(fin, zona) : null;

  if (inicio && !scheduledAt)
    return { error: "La hora de inicio no es válida." };
  if (fin && !scheduledEnd) return { error: "La hora de fin no es válida." };
  if (scheduledAt && scheduledEnd && scheduledAt >= scheduledEnd) {
    return { error: "El heat no puede terminar antes de empezar." };
  }

  const { error } = await supabase
    .from("heats")
    .update({
      arena_id: arenaId,
      scheduled_at: scheduledAt,
      scheduled_end_at: scheduledEnd,
    })
    .eq("id", heatId);

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

// --- Colaboradores ----------------------------------------------------------

/**
 * Invita —o actualiza— un colaborador del evento.
 *
 * EL ROL SE DEDUCE DE LOS PERMISOS, no se elige aparte. La pantalla pregunta que
 * puede hacer la persona; traducirlo a uno de los cinco roles es trabajo del
 * codigo, no del organizador. Pedir las dos cosas garantiza que un dia no
 * coincidan: un "juez" con permiso de cargar scores, y nadie sabiendo cual de
 * los dos manda.
 *
 * `event_role()` sigue devolviendo el MAYOR entre el rol de la organizacion y el
 * del evento, asi que el rol deducido nunca le quita nada a quien ya tenia mas.
 */
export async function invitarColaborador(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const email = String(formData.get("email") ?? "").trim();

  await requireManage(eventId);
  if (!email.includes("@")) return { error: "Escribe un correo válido." };

  const marcado = (campo: string) => formData.get(campo) === "on";

  const esAdmin = marcado("isAdmin");
  const editaRegistros = marcado("canEditRegistrations");
  const borraRegistros = marcado("canDeleteRegistrations");
  const editaScores = marcado("canEditScores");
  const gestionaWorkouts = marcado("canManageWorkouts");

  // Un colaborador sin permisos seria un juez, y los jueces tienen su propia
  // pantalla. Se avisa en vez de crearlo en silencio: si no, el organizador lo
  // agrega aca, no lo ve en la lista, y lo agrega de nuevo.
  const soloJuez =
    !esAdmin &&
    !editaRegistros &&
    !borraRegistros &&
    !editaScores &&
    !gestionaWorkouts;

  if (soloJuez && formData.get("exigePermiso") === "si") {
    return {
      error:
        "Marca al menos un permiso, o agrégalo como juez desde la sección Jueces.",
    };
  }

  const role: EventStaffRole = esAdmin
    ? "manager"
    : editaRegistros || borraRegistros
      ? "registrar"
      : editaScores
        ? "scorekeeper"
        : "judge";

  // Vacio = todas las categorias. Es una lista de EXCEPCIONES, no la lista
  // completa: sin esto, cada categoria nueva habria que agregarla a mano a cada
  // colaborador.
  const divisiones = formData.getAll("divisions").map(String).filter(Boolean);

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_event_staff", {
    p_event_id: eventId,
    p_email: email,
    p_role: role,
    p_is_admin: esAdmin,
    p_can_edit_registrations: editaRegistros,
    p_can_delete_registrations: borraRegistros,
    p_can_edit_scores: editaScores,
    p_can_manage_workouts: gestionaWorkouts,
    p_divisions: divisiones.length > 0 ? divisiones : undefined,
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

export async function quitarColaborador(
  eventId: string,
  staffId: string,
): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_event_staff", {
    p_staff_id: staffId,
  });
  if (error)
    return { error: error.message || "No se pudo quitar al colaborador." };

  refrescar(eventId);
  return OK;
}

/**
 * Aprueba una postulacion publica de juez (o cualquier fila sin aprobar).
 *
 * Hasta que esto se llama, `event_staff_role()` no le devuelve nada a esa
 * persona: no puede tomar carril ni ver nada del evento. Es la garantia de
 * "siempre verificado por la organizacion" para quien se postulo solo, a
 * diferencia de a quien la organizacion invito por correo, que queda
 * aprobado de una.
 */
export async function aprobarJuez(
  eventId: string,
  staffId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_event_staff", {
    p_staff_id: staffId,
  });
  if (error)
    return { error: error.message || "No se pudo aprobar la postulación." };

  refrescar(eventId);
  return OK;
}

/**
 * Rechaza una postulacion: es quitarla, igual que a un colaborador.
 * Se separa de `quitarColaborador` solo por nombre, para que la pantalla de
 * jueces pueda decir "Rechazar" en vez de "Quitar" sobre una postulacion.
 */
export async function rechazarJuez(
  eventId: string,
  staffId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_event_staff", {
    p_staff_id: staffId,
  });
  if (error)
    return { error: error.message || "No se pudo rechazar la postulación." };

  refrescar(eventId);
  return OK;
}

/**
 * Prende o apaga que un juez pueda tomar su propio carril desde /juez.
 *
 * Apagado, `claim_lane` lo rechaza para cualquiera sin `can_verify_event`: la
 * unica forma de asignar un carril pasa a ser `transfer_lane` desde /heats,
 * con anticipacion, por la organizacion.
 */
export async function actualizarAutoasignacion(
  eventId: string,
  permitir: boolean,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({ allow_judge_self_claim: permitir })
    .eq("id", eventId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return OK;
}

/**
 * Suma de una vez a varias personas que ya trabajaron con la organizacion.
 *
 * ES LO QUE HACE VIABLE INVITAR POR EVENTO. Que un juez tenga acceso a UN evento
 * y no a todos es la decision correcta —permite contratar a alguien para una
 * fecha sin darle el historial completo, y correr dos competencias en simultaneo
 * sin que los jueces de una vean los carriles de la otra— pero su costo es la
 * carga administrativa: un box que hace una fecha por mes con los mismos doce
 * jueces tendria que escribir doce correos cada vez.
 *
 * El modelo de permisos no cambia: cada invitacion sigue siendo a ESTE evento.
 * Lo unico que se ahorra es volver a tipear.
 */
export async function reusarColaboradores(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const correos = formData.getAll("emails").map(String).filter(Boolean);
  const comoJuez = formData.get("comoJuez") === "si";

  await requireManage(eventId);
  if (correos.length === 0) return { error: "Elige al menos a una persona." };

  const supabase = await createClient();

  // De a uno y no en lote: `invite_event_staff` resuelve el `user_id` por
  // correo, arma el alcance y hace su propio upsert. Una version masiva seria
  // una segunda implementacion de todo eso.
  for (const email of correos) {
    const { error } = await supabase.rpc("invite_event_staff", {
      p_event_id: eventId,
      p_email: email,
      p_role: comoJuez ? "judge" : "scorekeeper",
      p_is_admin: false,
      p_can_edit_registrations: false,
      p_can_delete_registrations: false,
      // Un colaborador reusado entra con el permiso mas comun; los demas se
      // ajustan despues. Adivinar los cuatro seria adivinar de mas.
      p_can_edit_scores: !comoJuez,
      p_can_manage_workouts: false,
    });

    if (error) return { error: traducir(error) };
  }

  refrescar(eventId);
  return OK;
}
