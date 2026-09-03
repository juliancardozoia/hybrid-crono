import type { PaymentProvider } from "@/lib/supabase/types";
import type { Adaptador } from "./tipos";
import { efectivo, transferencia } from "./transferencia";
import { mercadopago } from "./mercadopago";
import { addi, paypal } from "./pendientes";

/**
 * El registro de pasarelas.
 *
 * Agregar una es agregar una entrada aquí y un archivo que cumpla la interfaz.
 * Ni la ruta del webhook, ni la pantalla de configuración, ni la de pago
 * necesitan enterarse.
 */
export const ADAPTADORES: Record<PaymentProvider, Adaptador> = {
  transferencia,
  efectivo,
  mercadopago,
  paypal,
  addi,
};

/**
 * Los medios que el organizador puede ofrecer HOY.
 *
 * Sin efectivo: cobrar en la puerta no pasa por la plataforma —no hay orden que
 * registrar, ni comprobante, ni webhook— y ofrecerlo como si lo fuera deja
 * inscripciones "esperando pago" que nunca se confirman solas. Quien cobra en
 * efectivo confirma la inscripción a mano, que es lo que ya hace
 * `confirmar_pago_manual`.
 *
 * El valor del enum se queda: hay órdenes cargadas que lo referencian, y quitar
 * un valor de un enum de Postgres obliga a recrear la columna.
 */
export const MEDIOS_OFRECIDOS: PaymentProvider[] = [
  "transferencia",
  "mercadopago",
  "paypal",
  "addi",
];

export function adaptador(provider: PaymentProvider): Adaptador {
  return ADAPTADORES[provider];
}

export * from "./tipos";
