"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManage } from "@/features/events/lib/access";
import { puntosDinamicos } from "@/shared/scoring/points";

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}/puntuacion`);
  revalidatePath(`/panel/eventos/${eventId}/leaderboard`);
}

function traducir(error: { code?: string; message?: string }): string {
  // El mensaje del servidor gana: lo escribio la funcion para que lo lea el
  // organizador ("la tabla ya esta bloqueada..."), y un texto generico aca lo
  // tiraria a la basura — el mismo bug que ya mordio en `config/actions.ts`.
  return error.message ?? "No se pudo guardar la tabla de puntuación.";
}

/**
 * Genera (o regenera) la tabla de una categoria y opcionalmente la bloquea.
 *
 * La CURVA se calcula aca, en TypeScript, con la misma funcion pura que usan
 * el leaderboard en vivo y el recalculo del servidor. La base solo guarda el
 * resultado: si la formula viviera tambien en SQL, tarde o temprano difieren y
 * el podio dependeria de cual de las dos leyo cada pantalla.
 */
export async function generarTablaDePuntuacion(
  eventId: string,
  divisionId: string,
  fieldSize: number,
  bloquear: boolean,
): Promise<FormState> {
  await requireManage(eventId);

  if (!Number.isFinite(fieldSize) || fieldSize < 1) {
    return { error: "El tamaño de la categoría tiene que ser al menos 1." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("guardar_snapshot_de_puntuacion", {
    p_division_id: divisionId,
    p_field_size: Math.floor(fieldSize),
    p_points: puntosDinamicos(Math.floor(fieldSize)),
    p_stage: 1,
    p_lock: bloquear,
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}

/** Congela la tabla ya generada: a partir de aca los puntos no se mueven. */
export async function bloquearTablaDePuntuacion(
  eventId: string,
  divisionId: string,
): Promise<FormState> {
  await requireManage(eventId);

  const supabase = await createClient();
  const { error } = await supabase.rpc("bloquear_snapshot_de_puntuacion", {
    p_division_id: divisionId,
    p_stage: 1,
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}
