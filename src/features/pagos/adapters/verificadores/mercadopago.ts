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

/** Cuanto se espera la respuesta de la API antes de darla por caida. */
const TIMEOUT_CONSULTA_MS = 8000;

export interface CredencialesMercadoPago {
  webhookSecret: string;
  accessToken: string;
}

/**
 * Interpreta el contenido YA DESCIFRADO de `secret_ciphertext`.
 *
 * Desde que existe el access token, se guarda como JSON
 * `{"webhookSecret": "...", "accessToken": "..."}`. Una fila guardada ANTES
 * de este cambio es texto plano: todo el contenido ERA la firma del webhook.
 * Los dos formatos se siguen leyendo -- si no, una organizacion que configuro
 * MercadoPago hace tiempo y no volvio a esta pantalla dejaria de verificar
 * firmas de un dia para el otro.
 */
export function leerCredencialesMercadoPago(
  textoDescifrado: string | null,
): CredencialesMercadoPago {
  if (!textoDescifrado) return { webhookSecret: "", accessToken: "" };

  try {
    const parsed = JSON.parse(textoDescifrado) as {
      webhookSecret?: unknown;
      accessToken?: unknown;
    };
    if (parsed && typeof parsed === "object" && typeof parsed.webhookSecret === "string") {
      return {
        webhookSecret: parsed.webhookSecret,
        accessToken: typeof parsed.accessToken === "string" ? parsed.accessToken : "",
      };
    }
  } catch {
    // No es JSON: formato viejo, todo el texto es el secreto del webhook.
  }

  return { webhookSecret: textoDescifrado, accessToken: "" };
}

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

/**
 * Traduce el estado de MercadoPago al nuestro.
 *
 * `in_process`/`authorized`/`pending` son "MercadoPago lo esta procesando
 * activamente" -- ni aprobado ni rechazado, pero tampoco "nadie intento
 * pagar todavia" (que es lo que significa nuestro `pendiente`). Por eso caen
 * en `procesando`, un estado distinto.
 */
export function traducirEstado(estado: string): EstadoDePago {
  if (estado === "approved") return "aprobado";
  if (["rejected", "cancelled", "refunded", "charged_back"].includes(estado)) return "rechazado";
  if (["in_process", "authorized", "pending"].includes(estado)) return "procesando";
  return "pendiente";
}

interface PagoMercadoPago {
  id: number | string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  external_reference: string | null;
}

type ResultadoDeConsulta =
  | { ok: true; pago: PagoMercadoPago }
  | { ok: false; motivo: string };

/**
 * Consulta el pago real contra la API de MercadoPago.
 *
 * Es el paso que faltaba: la notificacion del webhook solo trae un id, y
 * confiar en el `status` que venga en su cuerpo seria confiar en un mensaje
 * que cualquiera con la URL podria intentar falsificar (la firma prueba que
 * el MENSAJE es de MercadoPago, no que el ESTADO que declara sea el actual).
 * Ante cualquier falla de red o de credenciales, no se confirma nada: el
 * llamador trata esto como `verificado: false`.
 */
async function consultarPagoMercadoPago(
  paymentId: string,
  accessToken: string,
): Promise<ResultadoDeConsulta> {
  try {
    const respuesta = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_CONSULTA_MS),
      },
    );

    if (!respuesta.ok) {
      return { ok: false, motivo: `MercadoPago respondió ${respuesta.status} al consultar el pago.` };
    }

    const pago = (await respuesta.json()) as PagoMercadoPago;
    if (pago.id === undefined || pago.id === null) {
      return { ok: false, motivo: "La respuesta de MercadoPago no trae un id de pago." };
    }

    return { ok: true, pago };
  } catch (err) {
    return {
      ok: false,
      motivo: `No se pudo consultar el pago en MercadoPago: ${err instanceof Error ? err.message : "error desconocido"}`,
    };
  }
}

/**
 * Verifica un webhook de MercadoPago.
 *
 * Dos pasos, ninguno opcional:
 *
 *   1. La FIRMA prueba que el mensaje lo mando MercadoPago.
 *   2. La CONSULTA A LA API prueba que el estado que se va a usar es el
 *      real, no el que traia el cuerpo del mensaje.
 *
 * Sin access token configurado (organizaciones que todavia no lo cargaron, o
 * migraron desde antes de que existiera este campo) se preserva el
 * comportamiento historico: firma valida, estado `pendiente`, queda para
 * confirmar a mano. Nunca se aprueba un pago sin haber pasado por el paso 2.
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

  const { webhookSecret, accessToken } = leerCredencialesMercadoPago(ctx.secreto);

  const firma = verificarFirmaMercadoPago({
    firma: ctx.headers.get("x-signature"),
    requestId: ctx.headers.get("x-request-id"),
    dataId,
    secreto: webhookSecret || null,
  });

  if (!firma.valida) return { verificado: false, motivo: firma.motivo ?? "Firma inválida." };

  const orderIdDelCuerpo =
    typeof cuerpo.external_reference === "string" ? cuerpo.external_reference : null;

  if (!accessToken) {
    return {
      verificado: true,
      externalId: dataId!,
      estado: "pendiente",
      orderId: orderIdDelCuerpo,
      montoCents: null,
      currency: null,
      raw: cuerpo,
    };
  }

  const consulta = await consultarPagoMercadoPago(dataId!, accessToken);
  if (!consulta.ok) return { verificado: false, motivo: consulta.motivo };

  const { pago } = consulta;

  // El id que responde la API tiene que ser el mismo que trajo la
  // notificacion -- si no, algo no cierra y no se confia en nada de esto.
  if (String(pago.id) !== dataId) {
    return {
      verificado: false,
      motivo: "El id del pago consultado no coincide con el de la notificación.",
    };
  }

  return {
    verificado: true,
    externalId: String(pago.id),
    estado: traducirEstado(pago.status),
    orderId: pago.external_reference ?? orderIdDelCuerpo,
    montoCents: Math.round(pago.transaction_amount * 100),
    currency: pago.currency_id ? pago.currency_id.toUpperCase() : null,
    raw: pago,
  };
};
