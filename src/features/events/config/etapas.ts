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
  // organizador ("el corte de esta etapa ya esta confirmado..."), y un texto
  // generico aca lo tiraria a la basura.
  return error.message ?? "No se pudo confirmar el corte.";
}

/**
 * Confirma quien avanza a una etapa, y congela su tabla de puntos.
 *
 * ES UNA DECISION EXPLICITA, NUNCA AUTOMATICA: nada calcula solo un top-N.
 * El organizador elige los equipos en la pantalla (mirando el leaderboard de
 * la etapa anterior) y esta accion los graba de una — corte y snapshot en la
 * misma transaccion, del lado de la base (`confirmar_corte_de_etapa`), para
 * que no quede una ventana donde alguien avanzo sin tabla congelada.
 *
 * No se puede rehacer: la funcion rechaza un `p_stage` cuyo snapshot ya este
 * bloqueado.
 */
export async function confirmarCorteDeEtapa(
  eventId: string,
  divisionId: string,
  stage: number,
  teamIds: string[],
): Promise<FormState> {
  await requireManage(eventId);

  if (teamIds.length === 0) {
    return { error: "Elegí al menos un equipo que avance." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("confirmar_corte_de_etapa", {
    p_division_id: divisionId,
    p_stage: stage,
    p_team_ids: teamIds,
    p_points: puntosDinamicos(teamIds.length),
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}
