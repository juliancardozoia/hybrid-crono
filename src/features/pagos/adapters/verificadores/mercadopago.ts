import { createHmac } from "node:crypto";
import { firmasIguales } from "../../lib/cifrado";
import type {
  ContextoDeWebhook,
  EstadoDePago,
  ResultadoDeWebhook,
  VerificadorDeWebhook,
} from "../tipos";

/**
 * MercadoPago.
 *
 * Es la pasarela con mejor cobertura en la region, asi que es la primera que se
 * integra de verdad.
 *
 * COMO SE VERIFICA UN WEBHOOK
 *
 * MercadoPago manda dos cabeceras:
 *
 *   x-signature:  ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8...
 *   x-request-id: c4bd6a90-...
 *
 * Y la firma se calcula sobre un manifiesto con una forma exacta, incluidos los
 * punto y coma finales:
 *
 *   id:{data.id};request-id:{x-request-id};ts:{ts};
 *
 * El HMAC va con SHA-256 y la clave secreta del webhook. Cualquier desvio —un
 * separador de mas, el id en mayusculas— da otra firma, asi que la verificacion
 * es todo o nada.
 */

/** Cuanto tiempo se acepta un webhook. Mas viejo que esto es un replay. */
const VENTANA_MS = 5 * 60 * 1000;

interface FirmaMercadoPago {
  ts: string;
  v1: string;
}

/** Parsea `ts=...,v1=...`. Devuelve null si falta cualquiera de las dos. */
export function parsearFirma(cabecera: string | null): FirmaMercadoPago | null {
  if (!cabecera) return null;

  const partes = Object.fromEntries(
    cabecera
      .split(",")
      .map((p) => p.split("=", 2).map((x) => x.trim()))
      .filter((p) => p.length === 2) as Array<[string, string]>,
  );

  if (!partes.ts || !partes.v1) return null;
  return { ts: partes.ts, v1: partes.v1 };
}

export function manifiesto(dataId: string, requestId: string, ts: string): string {
  // Los punto y coma finales son parte del formato, no un descuido.
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

export interface VerificacionDeFirma {
  valida: boolean;
  motivo?: string;
}

/**
 * Verifica la firma de un webhook de MercadoPago.
 *
 * Pura y exportada para poder testearla: es la pieza donde un error deja
 * inscripciones gratis para cualquiera que sepa la URL.
 */
export function verificarFirmaMercadoPago(params: {
  firma: string | null;
  requestId: string | null;
  dataId: string | null;
  secreto: string | null;
  ahoraMs?: number;
}): VerificacionDeFirma {
  const { firma, requestId, dataId, secreto } = params;
  const ahora = params.ahoraMs ?? Date.now();

  // Sin secreto configurado NO se acepta nada. La alternativa —aceptar todo
  // mientras el organizador no configure— es exactamente el agujero.
  if (!secreto) return { valida: false, motivo: "Falta la clave secreta del webhook." };
  if (!dataId) return { valida: false, motivo: "El webhook no trae el id del pago." };

  const partes = parsearFirma(firma);
  if (!partes) return { valida: false, motivo: "Falta la cabecera x-signature o está mal formada." };

  const tsMs = Number(partes.ts) * 1000;
  if (!Number.isFinite(tsMs)) return { valida: false, motivo: "La marca de tiempo no es válida." };

  // Sin ventana, una firma capturada una vez sirve para siempre.
  if (Math.abs(ahora - tsMs) > VENTANA_MS) {
    return { valida: false, motivo: "El webhook llegó fuera de la ventana de tiempo aceptada." };
  }

  const esperada = createHmac("sha256", secreto)
    .update(manifiesto(dataId, requestId ?? "", partes.ts))
    .digest("hex");

  if (!firmasIguales(esperada, partes.v1.toLowerCase())) {
    return { valida: false, motivo: "La firma no coincide." };
  }

  return { valida: true };
}

/** Traduce el estado de MercadoPago al nuestro. */
export function traducirEstado(estado: string): EstadoDePago {
  if (estado === "approved") return "aprobado";
  if (["rejected", "cancelled", "refunded", "charged_back"].includes(estado)) return "rechazado";
  return "pendiente";
}

/**
 * Verifica un webhook de MercadoPago.
 *
 * Devuelve `estado: "pendiente"` incluso cuando la firma es valida: la
 * notificacion solo trae el id del pago, y darlo por aprobado seria confiar en
 * el cuerpo del mensaje. El estado real hay que preguntarselo a MercadoPago.
 */
export const verificarMercadoPago: VerificadorDeWebhook = async (
  ctx: ContextoDeWebhook,
): Promise<ResultadoDeWebhook> => {
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = JSON.parse(ctx.cuerpo) as Record<string, unknown>;
  } catch {
    return { verificado: false, motivo: "El cuerpo del webhook no es JSON." };
  }

  const data = (cuerpo.data ?? {}) as Record<string, unknown>;
  const dataId = data.id !== undefined && data.id !== null ? String(data.id) : null;

  const firma = verificarFirmaMercadoPago({
    firma: ctx.headers.get("x-signature"),
    requestId: ctx.headers.get("x-request-id"),
    dataId,
    secreto: ctx.secreto,
  });

  if (!firma.valida) return { verificado: false, motivo: firma.motivo ?? "Firma inválida." };

  return {
    verificado: true,
    externalId: dataId!,
    estado: "pendiente",
    orderId: typeof cuerpo.external_reference === "string" ? cuerpo.external_reference : null,
    montoCents: null,
    raw: cuerpo,
  };
};
