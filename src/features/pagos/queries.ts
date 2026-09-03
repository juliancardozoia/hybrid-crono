import { createClient } from "@/lib/supabase/server";
import type { OrderRow, PaymentProvider } from "@/lib/supabase/types";

/**
 * Lecturas de pagos.
 *
 * Ninguna toca `payment_providers.secret_ciphertext`: esa columna no tiene
 * GRANT de select, asi que ni siquiera el texto cifrado sale por PostgREST. Lo
 * que la pantalla necesita —a donde transferir, si hay credencial cargada— sale
 * de `medios_de_pago()`, que devuelve solo eso.
 */

export interface MedioDePago {
  id: string;
  provider: PaymentProvider;
  label: string | null;
  publicConfig: Record<string, unknown>;
  configurado: boolean;
}

export interface PagoDeInscripcion {
  orden: OrderRow | null;
  medios: MedioDePago[];
}

export async function getPagoDeInscripcion(registrationId: string): Promise<PagoDeInscripcion> {
  const supabase = await createClient();

  const [{ data: orden }, { data: medios }] = await Promise.all([
    supabase.from("orders").select("*").eq("registration_id", registrationId).maybeSingle(),
    supabase.rpc("medios_de_pago", { p_registration_id: registrationId }),
  ]);

  return {
    orden: orden ?? null,
    medios: (medios as unknown as MedioDePago[]) ?? [],
  };
}

export interface OrdenDelPanel {
  id: string;
  registrationId: string;
  status: OrderRow["status"];
  totalCents: number;
  currency: string;
  provider: PaymentProvider | null;
  paidAt: string | null;
}

/** Las ordenes de un evento, para la organizacion. */
export async function getOrdenesDelEvento(eventId: string): Promise<Map<string, OrdenDelPanel>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, registration_id, status, total_cents, currency, provider, paid_at")
    .eq("event_id", eventId);

  return new Map(
    (data ?? []).map((o) => [
      o.registration_id,
      {
        id: o.id,
        registrationId: o.registration_id,
        status: o.status,
        totalCents: o.total_cents,
        currency: o.currency,
        provider: o.provider,
        paidAt: o.paid_at,
      },
    ]),
  );
}
