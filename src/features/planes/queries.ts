import { createClient } from "@/lib/supabase/server";
import type { OrgPlan } from "@/lib/supabase/types";

/**
 * Lo que el plan habilita o bloquea en ESTE evento.
 *
 * Sale de `event_plan_status()`, una sola llamada, y no de leer
 * `organizations.plan` y razonar en el cliente. Que la respuesta venga armada
 * del servidor es lo que hace que la pantalla y la base no puedan discrepar:
 * si mañana el corte cambia, cambia en un lugar.
 */
export interface EstadoDelPlan {
  plan: OrgPlan;
  puedePublicar: boolean;
  puedeJuzgarEnVivo: boolean;
  muestraEnVivo: boolean;
  otrasActivas: number;
  pruebasManualesForzadas: number;
  tieneTarjeta: boolean;
}

export async function getEstadoDelPlan(eventId: string): Promise<EstadoDelPlan | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("event_plan_status", { p_event_id: eventId });
  return (data as unknown as EstadoDelPlan | null) ?? null;
}

export interface PlanDeOrganizacion {
  plan: OrgPlan;
  tarjeta: {
    provider: string;
    brand: string | null;
    last4: string | null;
    expMonth: number | null;
    expYear: number | null;
    holder: string | null;
    taxId: string | null;
    billingEmail: string | null;
  } | null;
  /** Competencias que hoy ocupan el cupo del plan gratuito. */
  activas: Array<{ id: string; name: string }>;
}

export async function getPlanDeOrganizacion(orgId: string): Promise<PlanDeOrganizacion | null> {
  const supabase = await createClient();

  const [{ data: org }, { data: cuenta }, { data: activas }] = await Promise.all([
    supabase.from("organizations").select("plan").eq("id", orgId).maybeSingle(),
    // `card_token` no se pide: la columna no tiene GRANT de select. Para
    // mostrar la tarjeta alcanza con la marca y los ultimos cuatro digitos.
    supabase
      .from("billing_accounts")
      .select(
        "provider, card_brand, card_last4, card_exp_month, card_exp_year, holder_name, tax_id, billing_email",
      )
      .eq("org_id", orgId)
      .maybeSingle(),
    supabase
      .from("events")
      .select("id, name")
      .eq("org_id", orgId)
      .in("status", ["ready", "live", "verifying"])
      .order("name"),
  ]);

  if (!org) return null;

  return {
    plan: org.plan,
    tarjeta: cuenta
      ? {
          provider: cuenta.provider,
          brand: cuenta.card_brand,
          last4: cuenta.card_last4,
          expMonth: cuenta.card_exp_month,
          expYear: cuenta.card_exp_year,
          holder: cuenta.holder_name,
          taxId: cuenta.tax_id,
          billingEmail: cuenta.billing_email,
        }
      : null,
    activas: activas ?? [],
  };
}
