"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { esLimiteDePlan } from "./lib/errores";

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo guardar.";
  // Los limites del plan traen su propio mensaje, escrito para el organizador.
  if (esLimiteDePlan(error)) return error.message ?? "Esto es del plan Pro.";
  if (error.code === "42501") return "Solo el dueño de la organización cambia el plan.";
  return error.message ?? "No se pudo guardar.";
}

function refrescar() {
  revalidatePath("/panel", "layout");
}

/**
 * Guarda el medio con el que le cobramos el plan al organizador.
 *
 * NUNCA llega aquí un número de tarjeta. Lo que se guarda es el token que
 * devuelve la pasarela al tokenizar: sirve para cobrar en esta plataforma y no
 * sirve para nada más. Mientras no exista la integración real, el campo lo
 * escribe el organizador y hace de referencia; el día que se conecte la pasarela
 * lo llena su SDK desde el navegador y el PAN sigue sin pasar por aquí.
 */
export async function guardarTarjeta(_prev: FormState, formData: FormData): Promise<FormState> {
  const orgId = String(formData.get("orgId") ?? "");
  const provider = String(formData.get("provider") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();
  const last4 = String(formData.get("last4") ?? "").trim();
  const mes = Number(formData.get("mes") ?? 0);
  const anio = Number(formData.get("anio") ?? 0);

  if (!provider) return { error: "Elige con qué pasarela vas a pagar." };
  if (token.length < 4) return { error: "Falta la referencia de la tarjeta." };
  if (last4 && !/^[0-9]{4}$/.test(last4)) {
    return { error: "Los últimos cuatro dígitos son cuatro números." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("guardar_medio_de_cobro", {
    p_org_id: orgId,
    p_provider: provider,
    p_card_token: token,
    p_card_brand: String(formData.get("marca") ?? "").trim() || undefined,
    p_card_last4: last4 || undefined,
    p_card_exp_month: mes || undefined,
    p_card_exp_year: anio || undefined,
    p_holder_name: String(formData.get("titular") ?? "").trim() || undefined,
    p_tax_id: String(formData.get("nit") ?? "").trim() || undefined,
    p_billing_email: String(formData.get("email") ?? "").trim() || undefined,
  });

  if (error) return { error: traducir(error) };
  refrescar();
  return OK;
}

export async function activarPro(_prev: FormState, formData: FormData): Promise<FormState> {
  const orgId = String(formData.get("orgId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("activar_plan_pro", { p_org_id: orgId });
  if (error) return { error: traducir(error) };
  refrescar();
  return OK;
}

export async function cancelarPro(_prev: FormState, formData: FormData): Promise<FormState> {
  const orgId = String(formData.get("orgId") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancelar_plan_pro", { p_org_id: orgId });
  if (error) return { error: traducir(error) };
  refrescar();
  return OK;
}
