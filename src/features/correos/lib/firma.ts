import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificacion de los eventos que manda el proveedor de correo (rebotes y
 * quejas). Resend firma con Svix.
 *
 * LA REGLA, IDENTICA A LA DEL WEBHOOK DE PAGOS: un evento cuya firma no se pudo
 * verificar NUNCA hace nada. La URL es publica por definicion, asi que la firma
 * es la unica barrera — y si un tercero pudiera falsificar "rebote", podria
 * silenciar a atletas reales para que dejen de recibir sus invitaciones.
 *
 * Esta hecho estructural, no por disciplina: el resultado es un tipo
 * DISCRIMINADO y el evento solo existe en la rama `verificado: true`. El codigo
 * que suprime direcciones no compila si no chequeo la firma primero.
 *
 * Firma de Svix: HMAC-SHA256, en base64, sobre `${id}.${timestamp}.${cuerpo}`,
 * con la llave que sigue al prefijo `whsec_` (tambien en base64). La cabecera
 * puede traer varias firmas separadas por espacio, `v1,<firma>`, porque durante
 * una rotacion de secreto conviven dos.
 */

const TOLERANCIA_SEGUNDOS = 5 * 60;

export interface EventoDeCorreo {
  tipo: string;
  destinatarios: string[];
  /** Solo para rebotes: el proveedor distingue permanentes de transitorios. */
  rebote?: string;
}

export type VerificacionDeEvento =
  | { verificado: false; motivo: string }
  | { verificado: true; evento: EventoDeCorreo };

export interface CabecerasDeSvix {
  id: string | null;
  timestamp: string | null;
  firma: string | null;
}

export function firmarConSvix(secreto: string, id: string, timestamp: string, cuerpo: string): string {
  const llave = Buffer.from(secreto.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", llave).update(`${id}.${timestamp}.${cuerpo}`).digest("base64");
}

function iguales(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verificarEventoDeCorreo(
  cuerpo: string,
  cabeceras: CabecerasDeSvix,
  secreto: string | undefined,
  ahoraMs: number = Date.now(),
): VerificacionDeEvento {
  if (!secreto) return { verificado: false, motivo: "sin secreto configurado" };
  if (!cabeceras.id || !cabeceras.timestamp || !cabeceras.firma) {
    return { verificado: false, motivo: "faltan cabeceras de firma" };
  }

  // Sin ventana de tiempo, un mensaje legitimo capturado hoy se podria
  // reenviar dentro de un año y seguiria pasando la firma.
  const segundos = Number(cabeceras.timestamp);
  if (!Number.isFinite(segundos) || Math.abs(ahoraMs / 1000 - segundos) > TOLERANCIA_SEGUNDOS) {
    return { verificado: false, motivo: "marca de tiempo fuera de ventana" };
  }

  const esperada = firmarConSvix(secreto, cabeceras.id, cabeceras.timestamp, cuerpo);
  const coincide = cabeceras.firma
    .split(" ")
    .map((par) => par.split(","))
    .some(([version, firma]) => version === "v1" && !!firma && iguales(firma, esperada));

  if (!coincide) return { verificado: false, motivo: "firma invalida" };

  // Recien aca se lee el cuerpo como datos.
  try {
    const json = JSON.parse(cuerpo) as {
      type?: unknown;
      data?: { to?: unknown; bounce?: { type?: unknown } };
    };
    const para = Array.isArray(json.data?.to) ? json.data.to : [];
    return {
      verificado: true,
      evento: {
        tipo: typeof json.type === "string" ? json.type : "",
        destinatarios: para.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase().trim()),
        rebote: typeof json.data?.bounce?.type === "string" ? json.data.bounce.type : undefined,
      },
    };
  } catch {
    return { verificado: false, motivo: "cuerpo no es JSON" };
  }
}

/**
 * Que hacer con un evento ya verificado: por que razon se suprime, o `null` si
 * no se hace nada. Un rebote TRANSITORIO (buzon lleno, servidor caido un rato)
 * no suprime: es la direccion buena de una persona real con un mal momento.
 */
export function razonDeSupresion(
  evento: EventoDeCorreo,
): "bounce_permanente" | "queja" | null {
  if (evento.tipo === "email.complained") return "queja";
  if (evento.tipo === "email.bounced" && evento.rebote?.toLowerCase() === "permanent") {
    return "bounce_permanente";
  }
  return null;
}
