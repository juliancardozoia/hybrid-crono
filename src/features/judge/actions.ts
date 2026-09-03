"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { errorIncluye } from "@/shared/utils/matchError";

export interface ClaimState {
  error: string | null;
}

/**
 * Toma un carril.
 *
 * Toda la garantia esta en claim_lane: un UPDATE condicional que bajo
 * concurrencia deja ganar a uno solo. Aca no hay verificacion previa a
 * proposito, porque un "esta libre?" seguido de un "lo tomo" abre justo la
 * ventana que la funcion evita.
 */
export async function claimLane(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const laneId = String(formData.get("laneId") ?? "");
  if (!laneId) return { error: "Falta el carril." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_lane", { p_lane_id: laneId });

  if (error) {
    if (errorIncluye(error.message, "otro juez")) {
      return { error: "Ese carril lo tomó otro juez. Elige otro." };
    }
    if (errorIncluye(error.message, "no perteneces")) {
      return { error: "No perteneces a este evento, o tu postulación todavía no fue aprobada." };
    }
    if (errorIncluye(error.message, "ya tienes un carril activo")) {
      return { error: error.message };
    }
    if (errorIncluye(error.message, "autoasignación")) {
      return {
        error: "La organización desactivó la autoasignación: pídele a un organizador que te asigne un carril.",
      };
    }
    if (errorIncluye(error.message, "no estás habilitado")) {
      return { error: "No estás habilitado para juzgar esta categoría." };
    }
    return { error: "No se pudo tomar el carril." };
  }

  revalidatePath("/juez");
  redirect(`/juez/carril?id=${laneId}`);
}

/**
 * Devuelve el carril para que lo tome otro juez.
 *
 * transfer_lane deja hacer esto sin rol de verificacion CUANDO el que llama
 * es el juez que ya tiene el carril y lo suelta (p_to_judge null): es la
 * autoliberacion, no una reasignacion. Es lo que le permite a un juez
 * terminar su heat y quedar libre para tomar otro sin esperar el lease de
 * seis horas ni pedirselo a la organizacion.
 */
export async function releaseLane(laneId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("transfer_lane", {
    p_lane_id: laneId,
    p_to_judge: null as unknown as string,
    p_reason: "Liberado por el juez",
  });
  revalidatePath("/juez");
}
