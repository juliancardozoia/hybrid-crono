import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MensajeDeCorreo, ResultadoDeEnvio } from "./tipos";

/**
 * El UNICO punto que conoce al proveedor de correo.
 *
 * Cambiar de Resend a SES, o sumar uno de respaldo, es tocar este archivo: la
 * cola, las plantillas y los disparadores no saben quien entrega.
 *
 * Dos drivers, elegidos por `EMAIL_DRIVER`:
 *
 *   - `log`    desarrollo y pruebas: escribe el correo renderizado en consola y
 *              en `.correos-dev/`, no envia nada y no necesita dominio.
 *   - `resend` envio real.
 *
 * SIN la variable, en produccion FALLA en vez de caer en `log`: mismo criterio
 * que `PAYMENTS_ENCRYPTION_KEY`. Un correo que "se envio" a la consola de un
 * servidor no puede pasar en silencio — el atleta esperaria su invitacion para
 * siempre y nadie veria ningun error.
 */

export type DriverDeCorreo = "log" | "resend";

type Entorno = Record<string, string | undefined>;

/** `null` = mal configurado: el llamador tiene que fallar, no adivinar. */
export function driverConfigurado(env: Entorno = process.env): DriverDeCorreo | null {
  const valor = env.EMAIL_DRIVER?.trim().toLowerCase();
  if (valor === "log" || valor === "resend") return valor;
  if (valor) return null;
  return env.NODE_ENV === "production" ? null : "log";
}

export interface OpcionesDeEnvio {
  /**
   * Clave de idempotencia del proveedor. Si el worker muere DESPUES de enviar y
   * ANTES de marcar la fila, el reintento manda el mismo correo otra vez; con
   * esto el proveedor lo reconoce y no lo duplica.
   */
  idempotencia?: string;
  env?: Entorno;
  fetchFn?: typeof fetch;
  /** Donde escribe el driver `log`. Los tests apuntan a una carpeta temporal. */
  carpetaDeLog?: string;
}

export async function enviarCorreo(
  mensaje: MensajeDeCorreo,
  opciones: OpcionesDeEnvio = {},
): Promise<ResultadoDeEnvio> {
  const env = opciones.env ?? process.env;
  const driver = driverConfigurado(env);

  if (!driver) {
    return {
      ok: false,
      error:
        "EMAIL_DRIVER no esta configurado (o tiene un valor invalido). Usa 'resend' en produccion y 'log' en desarrollo.",
    };
  }

  if (driver === "log") return enviarALaConsola(mensaje, opciones.carpetaDeLog);
  return enviarPorResend(mensaje, env, opciones);
}

async function enviarALaConsola(
  mensaje: MensajeDeCorreo,
  carpeta = join(process.cwd(), ".correos-dev"),
): Promise<ResultadoDeEnvio> {
  const marca = new Date().toISOString().replace(/[:.]/g, "-");
  const destino = mensaje.para.replace(/[^a-z0-9@._-]/gi, "_");
  const base = join(carpeta, `${marca}-${destino}`);

  try {
    await mkdir(carpeta, { recursive: true });
    await writeFile(`${base}.html`, mensaje.html, "utf8");
    await writeFile(`${base}.txt`, `Para: ${mensaje.para}\nAsunto: ${mensaje.asunto}\n\n${mensaje.texto}`, "utf8");
  } catch (error) {
    return { ok: false, error: `No se pudo escribir el correo de prueba: ${(error as Error).message}` };
  }

  console.info(`[correo:log] Para: ${mensaje.para} | Asunto: ${mensaje.asunto} | ${base}.html`);
  return { ok: true, idExterno: `log:${marca}` };
}

async function enviarPorResend(
  mensaje: MensajeDeCorreo,
  env: Entorno,
  opciones: OpcionesDeEnvio,
): Promise<ResultadoDeEnvio> {
  const clave = env.RESEND_API_KEY?.trim();
  const remitente = env.EMAIL_FROM?.trim();
  if (!clave || !remitente) {
    return { ok: false, error: "Faltan RESEND_API_KEY y/o EMAIL_FROM." };
  }

  const cabeceras: Record<string, string> = {
    Authorization: `Bearer ${clave}`,
    "Content-Type": "application/json",
  };
  if (opciones.idempotencia) cabeceras["Idempotency-Key"] = opciones.idempotencia;

  const respuestaA = env.EMAIL_REPLY_TO?.trim();

  try {
    const respuesta = await (opciones.fetchFn ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({
        from: remitente,
        to: [mensaje.para],
        subject: mensaje.asunto,
        html: mensaje.html,
        text: mensaje.texto,
        ...(respuestaA ? { reply_to: respuestaA } : {}),
      }),
    });

    if (!respuesta.ok) {
      // Se corta el cuerpo: es lo que el proveedor dijo, y va a `last_error`.
      const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
      return { ok: false, error: `Resend respondio ${respuesta.status}: ${detalle}` };
    }

    const datos = (await respuesta.json().catch(() => ({}))) as { id?: string };
    return { ok: true, idExterno: datos.id };
  } catch (error) {
    // Red caida, DNS, timeout: es transitorio, se reintenta.
    return { ok: false, error: `No se pudo contactar a Resend: ${(error as Error).message}` };
  }
}
