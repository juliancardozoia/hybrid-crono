/**
 * Tipos del modulo de correos.
 *
 * Sin `server-only` a proposito: son solo formas de datos, y los tests de
 * plantillas y del procesador los importan sin necesitar el stub.
 */

/**
 * Los tipos de correo que la app sabe pintar.
 *
 * La base NO los restringe (`email_outbox.kind` es texto libre): agregar uno no
 * deberia exigir una migracion. Quien los restringe es `renderizarCorreo`, que
 * falla ante un tipo desconocido en vez de mandar un correo vacio.
 */
export const TIPOS_DE_CORREO = [
  "invitacion_equipo",
  "inscripcion_confirmada",
  "pago_recibido",
  "invitacion_staff",
  "juez_aprobado",
] as const;

export type TipoDeCorreo = (typeof TIPOS_DE_CORREO)[number];

/** Una fila de `email_outbox`, tal como la devuelve `interno_reclamar_correos`. */
export interface CorreoEnCola {
  id: string;
  kind: string;
  to_email: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface CorreoRenderizado {
  asunto: string;
  html: string;
  texto: string;
}

export interface MensajeDeCorreo extends CorreoRenderizado {
  para: string;
}

export type ResultadoDeEnvio = { ok: true; idExterno?: string } | { ok: false; error: string };
