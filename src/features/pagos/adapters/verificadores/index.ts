import "server-only";

import type { PaymentProvider } from "@/lib/supabase/types";
import type { VerificadorDeWebhook } from "../tipos";
import { verificarMercadoPago } from "./mercadopago";

/**
 * Los verificadores de webhook, que son SOLO de servidor.
 *
 * Estan separados de los descriptores porque usan node:crypto y el secreto del
 * organizador: nada de eso tiene por que existir en un bundle de navegador. El
 * descriptor (nombre, campos, instrucciones) si va al cliente; esto no.
 *
 * FALLA CERRADO POR DEFECTO: una pasarela sin verificador implementado nunca
 * acepta un webhook. Una integracion a medias que aceptara mensajes sin
 * verificar seria peor que no tenerla, porque cualquiera que supiera la URL
 * inscribiria equipos gratis.
 */
function noImplementado(nombre: string): VerificadorDeWebhook {
  return async () => ({
    verificado: false,
    motivo: `La verificación de webhooks de ${nombre} todavía no está implementada.`,
  });
}

export const VERIFICADORES: Record<PaymentProvider, VerificadorDeWebhook> = {
  mercadopago: verificarMercadoPago,
  // La transferencia y el efectivo se confirman a mano: no tienen webhook, y
  // aceptar uno seria dejar que cualquiera marque una transferencia recibida.
  transferencia: noImplementado("la transferencia"),
  efectivo: noImplementado("el efectivo"),
  paypal: noImplementado("PayPal"),
  addi: noImplementado("Addi"),
};
