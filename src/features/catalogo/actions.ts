"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCatalogo, type FichaDeCatalogo } from "./queries";

/**
 * Resuelve las fichas de los slugs que el navegador guardó como "vistos".
 *
 * Es una server action y no una consulta desde el cliente porque asi la lista
 * de slugs no sale del servidor de la app: el navegador la manda una vez y
 * recibe fichas armadas.
 */
export async function buscarPorSlugs(slugs: string[]): Promise<FichaDeCatalogo[]> {
  if (slugs.length === 0) return [];
  const { eventos } = await getCatalogo({ slugs: slugs.slice(0, 12), limite: 12 });
  return eventos;
}

export interface PostulacionState {
  error: string | null;
  enviada: boolean;
}

/**
 * `apply_as_judge` levanta sus errores de negocio con `raise exception` sin
 * codigo propio (quedan como P0001) y en español ya legible para quien se
 * postula -- esos se muestran tal cual. Cualquier otro codigo es un error de
 * infraestructura (conexion, constraint) que Postgres no escribio pensando en
 * quien esta llenando este formulario, y ahi conviene un mensaje generico en
 * vez de mostrar texto tecnico a un desconocido en el portal publico.
 */
function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo enviar la postulación.";
  if (error.code === "P0001" || !error.code) return error.message ?? "No se pudo enviar la postulación.";
  return "No se pudo enviar la postulación. Intenta de nuevo.";
}

/**
 * Se postula como juez de la competencia. Queda pendiente de aprobación: es
 * `apply_as_judge` quien decide todo -- login exigido, evento publicado, y
 * que no haya ya una fila de este correo -- esta acción solo traduce el error.
 */
export async function postularseComoJuez(
  _prev: PostulacionState,
  formData: FormData,
): Promise<PostulacionState> {
  const slug = String(formData.get("slug") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_as_judge", { p_public_slug: slug });

  if (error) return { error: traducir(error), enviada: false };

  revalidatePath(`/eventos/${slug}`);
  return { error: null, enviada: true };
}
