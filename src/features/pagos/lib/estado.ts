/**
 * Traduccion uniforme de PaymentStatus, a partir de la orden.
 *
 * Es TypeScript puro y no una funcion de Postgres a proposito: cada
 * consumidor (BloqueDePago, ConfirmarPago, la torre de inscripciones del
 * organizador) YA trae la orden completa en su query -- un RPC nuevo
 * agregaria un viaje de red para traducir un valor que ya esta en memoria.
 *
 * Desde que `orders` siempre existe (incluso con costo cero, ver la
 * migracion `20260916110000_pago_verificado_de_verdad.sql`), "sin orden"
 * solo puede pasar en un trámite que todavia no llego a `submit_registration`
 * -- se trata igual que "no requerido", que es lo que va a ser en cuanto se
 * envie.
 */

export type PaymentStatus =
  | "no_requerido"
  | "pendiente"
  | "procesando"
  | "pagado"
  | "fallido"
  | "reembolsado"
  | "vencido";

/**
 * Solo lo que hace falta de la orden -- no `OrderRow` completo, para poder
 * pasarle tambien un objeto armado a mano en un test sin mockear Supabase.
 */
export interface OrdenParaEstado {
  status: string;
  amount_cents: number;
}

const MAPA_ESTADO: Record<string, PaymentStatus> = {
  pagada: "pagado",
  procesando: "procesando",
  fallida: "fallido",
  reembolsada: "reembolsado",
  vencida: "vencido",
  pendiente: "pendiente",
};

export function paymentStatus(orden: OrdenParaEstado | null): PaymentStatus {
  if (!orden || orden.amount_cents === 0) return "no_requerido";
  return MAPA_ESTADO[orden.status] ?? "pendiente";
}

const TEXTO: Record<PaymentStatus, string> = {
  no_requerido: "Sin costo",
  pendiente: "Pago pendiente",
  procesando: "Pago en revisión",
  pagado: "Pago confirmado",
  fallido: "Pago fallido",
  reembolsado: "Reembolsado",
  vencido: "Pago vencido",
};

export function textoDePaymentStatus(orden: OrdenParaEstado | null): string {
  return TEXTO[paymentStatus(orden)];
}
