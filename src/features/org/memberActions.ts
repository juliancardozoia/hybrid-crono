"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/supabase/types";
import { absoluteUrl } from "@/shared/utils/appUrl";
import { errorIncluye } from "@/shared/utils/matchError";

export interface InviteState {
  error: string | null;
  mensaje: string | null;
  /**
   * Texto listo para mandarle a la persona por WhatsApp.
   *
   * Sumar a alguien no le avisa nada: solo escribe una fila. Sin esto, el
   * organizador queda con un juez agregado que no sabe que existe la app, con
   * que email registrarse ni a donde entrar.
   */
  instrucciones: string | null;
}

/**
 * Suma a alguien a la organizacion por email.
 *
 * Por email y no por id de usuario porque el organizador no tiene forma de
 * conocer el id de alguien que todavia no se registro. Si ya tiene cuenta entra
 * directo; si no, queda invitado y entra solo al darse de alta.
 */
export async function inviteMember(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const orgId = String(formData.get("orgId") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "judge") as OrgRole;

  if (!orgId) return { error: "Falta la organización.", mensaje: null, instrucciones: null };
  if (!email.includes("@")) {
    return { error: "Escribe un email válido.", mensaje: null, instrucciones: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_to_org", {
    p_org_id: orgId,
    p_email: email,
    p_role: role,
  });

  if (error) {
    if (errorIncluye(error.message, "dueno", "administrador")) {
      return { error: "No tienes permiso para invitar.", mensaje: null, instrucciones: null };
    }
    return { error: "No se pudo invitar.", mensaje: null, instrucciones: null };
  }

  const fila = (data as unknown as Array<{ estado: string; detalle: string }>)?.[0];
  const yaTeniaCuenta = fila?.estado === "agregado";

  // Nombre de la organizacion para el mensaje. Si falla, el texto igual sirve.
  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();

  const instrucciones = yaTeniaCuenta
    ? [
        `Te sumé como juez a "${org?.name ?? "la competencia"}" en Hybrid Crono.`,
        ``,
        `Ingresa con tu cuenta (${email}): ${absoluteUrl("/juez")}`,
        ``,
        `Tus carriles aparecen ahí. Desde el celular, agrega la página a la pantalla`,
        `de inicio para que funcione como app y ande sin señal.`,
      ].join("\n")
    : [
        `Te sumé como juez a "${org?.name ?? "la competencia"}" en Hybrid Crono.`,
        ``,
        `1. Ingresa a ${absoluteUrl("/registro")}`,
        `2. Regístrate con este email EXACTO: ${email}`,
        `3. Listo: tus carriles aparecen en "Juzgar"`,
        ``,
        `Atención con el email: tiene que ser tal cual, porque es lo que te vincula a la`,
        `competencia. Desde el celular, agrega la página a la pantalla de inicio`,
        `para que funcione como app y ande sin señal.`,
      ].join("\n");

  revalidatePath("/panel/organizacion/miembros");
  return {
    error: null,
    mensaje: yaTeniaCuenta
      ? `${email} ya tenía cuenta: quedó dentro de la organización.`
      : `${email} queda invitado. Entra solo cuando se registre con ese email.`,
    instrucciones,
  };
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("remove_org_member", { p_org_id: orgId, p_user_id: userId });
  revalidatePath("/panel/organizacion/miembros");
}

export async function cancelInvitation(invitationId: string): Promise<void> {
  const supabase = await createClient();
  // RLS ya limita el delete a los admins de esa organizacion.
  await supabase.from("org_invitations").delete().eq("id", invitationId);
  revalidatePath("/panel/organizacion/miembros");
}
