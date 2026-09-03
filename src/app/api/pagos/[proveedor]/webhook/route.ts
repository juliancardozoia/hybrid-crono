import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { descifrar } from "@/features/pagos/lib/cifrado";
import { ADAPTADORES } from "@/features/pagos/adapters";
import { VERIFICADORES } from "@/features/pagos/adapters/verificadores";
import type { PaymentProvider } from "@/lib/supabase/types";

/**
 * Webhook de pagos.
 *
 * LO QUE ESTA RUTA TIENE QUE GARANTIZAR
 *
 * Que nadie pueda marcar una orden como pagada sin ser la pasarela. La URL es
 * publica por definicion —la pasarela tiene que poder llegar sin credenciales—
 * asi que la unica barrera es la firma.
 *
 * Por eso el orden importa y no se puede invertir:
 *
 *   1. leer el cuerpo CRUDO (la firma se calcula sobre esos bytes exactos)
 *   2. sacar de ahi a que orden se refiere
 *   3. buscar el secreto DEL ORGANIZADOR de esa orden
 *   4. verificar la firma
 *   5. recien ahi, registrar el intento
 *
 * En cualquier punto en que algo no cierre, se responde 200 y NO se cobra nada.
 * El 200 es a proposito: un 4xx hace que la pasarela reintente durante horas un
 * mensaje que nunca vamos a aceptar.
 */

/** Nunca se filtra el motivo del rechazo al que llama: solo queda en el log. */
function rechazar(motivo: string) {
  console.warn(`[webhook de pagos] rechazado: ${motivo}`);
  return NextResponse.json({ recibido: true }, { status: 200 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ proveedor: string }> },
) {
  const { proveedor } = await params;

  const verificador = VERIFICADORES[proveedor as PaymentProvider];
  if (!ADAPTADORES[proveedor as PaymentProvider] || !verificador) {
    return rechazar(`proveedor desconocido: ${proveedor}`);
  }

  // Crudo, no parseado: parsear y volver a serializar cambia los bytes y la
  // firma deja de coincidir.
  const cuerpo = await request.text();

  let orderId: string | null = null;
  try {
    const json = JSON.parse(cuerpo) as Record<string, unknown>;
    // La orden viaja como referencia externa. Es lo que nos permite saber de
    // que organizador es el secreto con el que hay que verificar.
    orderId =
      typeof json.external_reference === "string"
        ? json.external_reference
        : typeof json.orderId === "string"
          ? json.orderId
          : null;
  } catch {
    return rechazar("el cuerpo no es JSON");
  }

  if (!orderId) return rechazar("el webhook no trae la referencia de la orden");

  // Service role: esta ruta no tiene usuario detras. La autorizacion la da la
  // firma, no una sesion.
  const service = createServiceClient();

  const { data: orden } = await service
    .from("orders")
    .select("id, event_id, status, total_cents")
    .eq("id", orderId)
    .maybeSingle();

  if (!orden) return rechazar(`la orden ${orderId} no existe`);

  const { data: evento } = await service
    .from("events")
    .select("org_id")
    .eq("id", orden.event_id)
    .maybeSingle();

  if (!evento) return rechazar("la orden no tiene evento");

  const { data: config } = await service
    .from("payment_providers")
    .select("secret_ciphertext")
    .eq("org_id", evento.org_id)
    .eq("provider", proveedor as PaymentProvider)
    .eq("active", true)
    .maybeSingle();

  let secreto: string | null = null;
  if (config?.secret_ciphertext) {
    try {
      secreto = descifrar(config.secret_ciphertext);
    } catch {
      // Un secreto que no se puede descifrar es un secreto que no sirve. No se
      // sigue adelante sin el.
      return rechazar("no se pudo descifrar el secreto del proveedor");
    }
  }

  const resultado = await verificador({ headers: request.headers, cuerpo, secreto });

  // ACA ESTA LA BARRERA. El tipo discriminado hace que los datos del pago solo
  // existan en la rama verificada: no se puede cobrar sin haber chequeado.
  if (!resultado.verificado) return rechazar(resultado.motivo);

  await service.rpc("registrar_intento_de_pago", {
    p_order_id: orden.id,
    p_provider: proveedor as PaymentProvider,
    p_status: resultado.estado,
    p_external_id: resultado.externalId,
    p_amount_cents: resultado.montoCents ?? undefined,
    p_raw: resultado.raw as never,
  });

  return NextResponse.json({ recibido: true });
}
