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
      return { error: "No perteneces a este evento." };
    }
    return { error: "No se pudo tomar el carril." };
  }

  revalidatePath("/juez");
  redirect(`/juez/carril?id=${laneId}`);
}

/** Devuelve el carril para que lo tome otro juez. */
export async function releaseLane(laneId: string): Promise<void> {
  const supabase = await createClient();
  // transfer_lane a null exige rol de verificacion; un juez comun suelta el
  // suyo dejando vencer el lease o pidiendoselo a la organizacion. Aca solo
  // intentamos, y si no tiene permiso no pasa nada.
  await supabase.rpc("transfer_lane", {
    p_lane_id: laneId,
    p_to_judge: null as unknown as string,
    p_reason: "Liberado por el juez",
  });
  revalidatePath("/juez");
}
