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

export interface IntentoDePago {
  id: string;
  status: string;
  referencia: string | null;
  /** URL FIRMADA, valida un rato -- el bucket `comprobantes` es privado. */
  receiptUrl: string | null;
  createdAt: string;
}

interface FilaIntento {
  id: string;
  status: string;
  receipt_url: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Los intentos de pago de UNA orden, con su comprobante ya firmado.
 *
 * `receipt_url` en la base es la RUTA cruda dentro del bucket `comprobantes`
 * -- privado, sin URL publica posible -- asi que aca se pide la URL firmada,
 * con la sesion de quien esta mirando. RLS de storage decide si puede: dueno
 * de la inscripcion u organizador, nunca un tercero.
 */
async function getIntentosDeOrden(orderId: string): Promise<IntentoDePago[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_attempts")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });

  const filas = (data ?? []) as unknown as FilaIntento[];

  return Promise.all(
    filas.map(async (fila) => {
      let receiptUrl: string | null = null;
      if (fila.receipt_url) {
        const { data: firmada } = await supabase.storage
          .from("comprobantes")
          .createSignedUrl(fila.receipt_url, 3600);
        receiptUrl = firmada?.signedUrl ?? null;
      }

      return {
        id: fila.id,
        status: fila.status,
        referencia: (fila.raw?.referencia as string | null | undefined) ?? null,
        receiptUrl,
        createdAt: fila.created_at,
      };
    }),
  );
}

export interface PagoDeInscripcion {
  orden: OrderRow | null;
  medios: MedioDePago[];
  intentos: IntentoDePago[];
}

export async function getPagoDeInscripcion(registrationId: string): Promise<PagoDeInscripcion> {
  const supabase = await createClient();

  const [{ data: orden }, { data: medios }] = await Promise.all([
    supabase.from("orders").select("*").eq("registration_id", registrationId).maybeSingle(),
    supabase.rpc("medios_de_pago", { p_registration_id: registrationId }),
  ]);

  const intentos = orden ? await getIntentosDeOrden(orden.id) : [];

  return {
    orden: orden ?? null,
    medios: (medios as unknown as MedioDePago[]) ?? [],
    intentos,
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

/**
 * Los intentos pendientes de revisar, para la torre de "Anotados" del
 * organizador -- con el comprobante ya firmado, sin que la pantalla tenga que
 * pedirlo orden por orden.
 */
export async function getIntentosPendientesDelEvento(
  eventId: string,
): Promise<Map<string, IntentoDePago[]>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payment_attempts")
    .select("*")
    .eq("event_id", eventId)
    .eq("status", "pendiente")
    .order("created_at", { ascending: false });

  const filas = (data ?? []) as unknown as (FilaIntento & { order_id: string })[];
  const porOrden = new Map<string, IntentoDePago[]>();

  for (const fila of filas) {
    let receiptUrl: string | null = null;
    if (fila.receipt_url) {
      const { data: firmada } = await supabase.storage
        .from("comprobantes")
        .createSignedUrl(fila.receipt_url, 3600);
      receiptUrl = firmada?.signedUrl ?? null;
    }

    const intento: IntentoDePago = {
      id: fila.id,
      status: fila.status,
      referencia: (fila.raw?.referencia as string | null | undefined) ?? null,
      receiptUrl,
      createdAt: fila.created_at,
    };

    const lista = porOrden.get(fila.order_id) ?? [];
    lista.push(intento);
    porOrden.set(fila.order_id, lista);
  }

  return porOrden;
}
