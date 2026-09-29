import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import {
  razonDeSupresion,
  verificarEventoDeCorreo,
} from "@/features/correos/lib/firma";

/**
 * Eventos del proveedor de correo: rebotes y quejas.
 *
 * Sin esto se sigue escribiendo a direcciones que rebotan o que marcaron spam,
 * el dominio pierde reputacion y con el tiempo TODO cae en spam, incluida la
 * verificacion de cuenta.
 *
 * Es la misma forma que el webhook de pagos y por la misma razon: la URL es
 * publica, asi que el orden no se puede invertir —cuerpo CRUDO, verificar la
 * firma, y recien ahi actuar— y ante cualquier duda se responde 200 SIN hacer
 * nada (un 4xx haria que el proveedor reintente durante horas un mensaje que
 * nunca vamos a aceptar).
 *
 * La unica excepcion es el secreto sin configurar: eso es un error nuestro, no
 * del emisor, y un 503 hace que el proveedor reintente cuando ya este puesto en
 * vez de perder los eventos.
 */

export const dynamic = "force-dynamic";

function ignorar(motivo: string) {
  console.warn(`[eventos de correo] ignorado: ${motivo}`);
  return NextResponse.json({ recibido: true }, { status: 200 });
}

export async function POST(request: Request) {
  const secreto = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secreto) {
    return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET no configurado" }, { status: 503 });
  }

  // Crudo, no parseado: la firma se calcula sobre esos bytes exactos.
  const cuerpo = await request.text();

  const verificacion = verificarEventoDeCorreo(
    cuerpo,
    {
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      firma: request.headers.get("svix-signature"),
    },
    secreto,
  );

  // Los datos del evento solo existen en la rama verificada.
  if (!verificacion.verificado) return ignorar(verificacion.motivo);

  const razon = razonDeSupresion(verificacion.evento);
  if (!razon || verificacion.evento.destinatarios.length === 0) {
    return NextResponse.json({ recibido: true }, { status: 200 });
  }

  // Sin el tipo `Database`: las tablas de la cola son de este modulo (ver
  // servicio.ts). `ignoreDuplicates` deja intacta la razon de la primera vez.
  const db = createServiceClient() as unknown as SupabaseClient;
  const { error } = await db
    .from("email_suppressions")
    .upsert(
      verificacion.evento.destinatarios.map((email) => ({ email, reason: razon })),
      { onConflict: "email", ignoreDuplicates: true },
    );

  if (error) {
    // Un 500 SI es correcto aca: la firma era buena y el evento es real, hay
    // que reintentarlo.
    console.error("[eventos de correo] no se pudo suprimir:", error.message);
    return NextResponse.json({ error: "no se pudo registrar" }, { status: 500 });
  }

  return NextResponse.json({ recibido: true }, { status: 200 });
}
