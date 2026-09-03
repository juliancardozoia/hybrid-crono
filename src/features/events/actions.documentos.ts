"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManage } from "@/features/events/lib/access";
import type { EventDocumentKind } from "@/lib/supabase/types";

export interface FormState {
  error: string | null;
}

/**
 * Registra un documento que el navegador ya subio a Storage.
 *
 * `requiresAcceptance` es lo que separa los dos grupos de la pantalla: los
 * documentos informativos se muestran en la ficha y punto; los terminos hay que
 * marcarlos leidos para poder inscribirse. Es la MISMA tabla con una bandera, y
 * no dos tablas, porque un reglamento puede pasar a ser obligatorio de un dia
 * para el otro sin mover el archivo de lugar.
 */
export async function agregarDocumento(
  eventId: string,
  datos: {
    nombre: string;
    url: string;
    kind: EventDocumentKind;
    requiereAceptacion: boolean;
  },
): Promise<FormState> {
  await requireManage(eventId);

  const nombre = datos.nombre.trim();
  if (!nombre) return { error: "El documento necesita un nombre." };

  const supabase = await createClient();

  // La URL tiene que apuntar a NUESTRO bucket. Sin esto, un organizador podria
  // dejar en la ficha publica un enlace a cualquier dominio, y los atletas
  // descargarian de ahi confiando en la plataforma.
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!datos.url.startsWith(`${base}/storage/v1/object/public/eventos/`)) {
    return { error: "Ese archivo no es válido." };
  }

  const { data: ultimo } = await supabase
    .from("event_documents")
    .select("order_index")
    .eq("event_id", eventId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("event_documents").insert({
    event_id: eventId,
    name: nombre,
    url: datos.url,
    kind: datos.kind,
    requires_acceptance: datos.requiereAceptacion,
    order_index: (ultimo?.order_index ?? -1) + 1,
  });

  if (error)
    return { error: error.message || "No se pudo guardar el documento." };

  refrescar(eventId);
  return { error: null };
}

export async function borrarDocumento(
  eventId: string,
  documentoId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  // El archivo queda en Storage a proposito: borrar la fila es reversible en un
  // minuto, borrar el PDF del reglamento no.
  const { error } = await supabase
    .from("event_documents")
    .delete()
    .eq("id", documentoId);
  if (error)
    return { error: error.message || "No se pudo quitar el documento." };

  refrescar(eventId);
  return { error: null };
}

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  revalidatePath(`/panel/asistente/${eventId}`, "layout");
}
