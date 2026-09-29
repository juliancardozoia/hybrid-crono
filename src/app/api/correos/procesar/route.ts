import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { procesarCorreosPendientes } from "@/features/correos/lib/servicio";

/**
 * Barrido de la cola de correos.
 *
 * Lo llama el barrido de reintentos (pg_cron + pg_net de Supabase, o Vercel
 * Cron), no una persona. El envio inmediato tras una accion NO pasa por aca:
 * sale de `dispararEnvioDeCorreos()`. Esta ruta es la red de seguridad para lo
 * que fallo o quedo a medias.
 *
 * Es publica para el middleware (el llamador no tiene sesion) y su barrera es
 * `CRON_SECRET`. SIN el secreto configurado responde 503 en vez de abrirse:
 * "no esta configurado" nunca puede significar "deja pasar a todos".
 */

export const dynamic = "force-dynamic";
// Un lote de 20 con la pausa que pide el proveedor son ~11 segundos.
export const maxDuration = 60;

function autorizado(request: Request, secreto: string): boolean {
  const recibido = request.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secreto}`;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function atender(request: Request) {
  const secreto = process.env.CRON_SECRET?.trim();
  if (!secreto) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }
  if (!autorizado(request, secreto)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  try {
    const resumen = await procesarCorreosPendientes();
    return NextResponse.json(resumen);
  } catch (error) {
    console.error("[correos] barrido fallido:", (error as Error).message);
    return NextResponse.json({ error: "no se pudo procesar la cola" }, { status: 500 });
  }
}

// POST para pg_net; GET porque Vercel Cron llama con GET.
export const POST = atender;
export const GET = atender;
