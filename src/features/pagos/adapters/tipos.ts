/**
 * La interfaz que cumple cada pasarela.
 *
 * LA REGLA QUE NO SE NEGOCIA
 *
 * Un webhook cuya firma no se pudo verificar NUNCA marca una orden como pagada.
 * Por eso `verificarWebhook` devuelve un tipo discriminado y no un booleano
 * suelto: los datos del pago solo existen en la rama `verificado: true`, asi
 * que el codigo que los usa no compila si no chequeo la firma primero.
 *
 * Sin eso, cualquiera que sepa la URL del webhook inscribe equipos gratis.
 */

export type EstadoDePago = "aprobado" | "rechazado" | "pendiente";

export type ResultadoDeWebhook =
  | {
      verificado: true;
      /** Id del pago en la pasarela. Es la clave de idempotencia. */
      externalId: string;
      estado: EstadoDePago;
      /** Nuestra orden, que viaja como referencia externa en la pasarela. */
      orderId: string | null;
      montoCents: number | null;
      raw: unknown;
    }
  | { verificado: false; motivo: string };

export interface ContextoDeWebhook {
  headers: Headers;
  /** El cuerpo crudo, sin parsear: la firma se calcula sobre los bytes exactos. */
  cuerpo: string;
  /** El secreto del organizador, ya descifrado. Null si no lo configuro. */
  secreto: string | null;
}

export interface InstruccionesDePago {
  /** Que hacer para pagar, en texto que lee una persona. */
  titulo: string;
  detalle: string[];
  /** A donde mandar al usuario, si la pasarela tiene checkout propio. */
  url?: string;
  /** true si la organizacion tiene que confirmar el pago a mano. */
  requiereConfirmacionManual: boolean;
}

/**
 * El DESCRIPTOR de una pasarela: como se llama, que pide y que muestra.
 *
 * Es lo unico que llega al navegador. La verificacion de webhooks vive aparte,
 * en `verificadores.ts`, porque usa node:crypto y el secreto del organizador —
 * nada de eso tiene por que existir en un bundle de cliente.
 */
export interface Adaptador {
  /** Como se llama para la gente. */
  nombre: string;
  /** Si necesita credenciales secretas para funcionar. */
  requiereSecreto: boolean;
  /** Que campos NO secretos pide, para armar el formulario de configuracion. */
  camposPublicos: Array<{ key: string; label: string; ayuda?: string }>;
  /** Que secreto pide, si pide alguno. */
  campoSecreto?: { label: string; ayuda?: string };

  /** Que ve quien va a pagar. */
  instrucciones(params: {
    publicConfig: Record<string, unknown>;
    totalCents: number;
    currency: string;
    orderId: string;
  }): InstruccionesDePago;
}

/** La mitad servidor: verifica y traduce un webhook. Falla cerrado ante la duda. */
export type VerificadorDeWebhook = (ctx: ContextoDeWebhook) => Promise<ResultadoDeWebhook>;

/** Formatea plata para mostrar. Sin decimales: los precios de la región no los usan. */
export function montoLegible(cents: number, currency: string): string {
  return new Intl.NumberFormat("es", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
