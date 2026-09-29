import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { appUrl } from "@/shared/utils/appUrl";
import { enviarCorreo } from "./enviar";
import { idiomaDeCorreo } from "./idioma";
import { procesarCola, type ResumenDeProcesamiento } from "./procesar";
import type { CorreoEnCola } from "./tipos";

/**
 * El cableado real del procesador: base + proveedor.
 *
 * El cliente va SIN el tipo `Database` a proposito: las funciones `interno_*`
 * y las tablas de la cola son de este modulo y no pertenecen a lo que la app
 * consulta con tipos. Se acota aca, en un solo archivo, en vez de esparcir
 * casts por todo el codigo.
 */

/** Resend admite ~2 envios por segundo. */
const PAUSA_ENTRE_ENVIOS_MS = 550;

export async function procesarCorreosPendientes(limite = 20): Promise<ResumenDeProcesamiento> {
  const db = createServiceClient() as unknown as SupabaseClient;
  const conPausa = process.env.EMAIL_DRIVER?.trim().toLowerCase() === "resend";

  return procesarCola(
    {
      baseUrl: appUrl(),
      pausaMs: conPausa ? PAUSA_ENTRE_ENVIOS_MS : 0,

      async reclamar(n) {
        const { data, error } = await db.rpc("interno_reclamar_correos", { p_limite: n });
        if (error) throw new Error(`No se pudo reclamar la cola: ${error.message}`);
        return (data ?? []) as CorreoEnCola[];
      },

      async marcar(id, ok, mensaje) {
        const { error } = await db.rpc("interno_marcar_correo", {
          p_id: id,
          p_ok: ok,
          p_error: mensaje ?? null,
        });
        if (error) throw new Error(`No se pudo marcar el correo: ${error.message}`);
      },

      async idiomaDe(email, pista) {
        // `eq` y no `ilike`: el guion bajo de un correo es comodin en un LIKE.
        // GoTrue guarda los correos en minusculas, y la cola tambien.
        const { data } = await db
          .from("profiles")
          .select("locale")
          .eq("email", email)
          .maybeSingle();
        return idiomaDeCorreo((data as { locale?: string | null } | null)?.locale, pista);
      },

      enviar: (mensaje, idempotencia) => enviarCorreo(mensaje, { idempotencia }),
    },
    limite,
  );
}
