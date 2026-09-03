import { redirect } from "next/navigation";

/**
 * La ficha se edita en el asistente, y en ningun otro lado.
 *
 * Esta ruta tenia su propio formulario, identico al del paso "general": dos
 * pantallas con las mismas preguntas, y ninguna garantia de que siguieran
 * iguales. Queda como redireccion porque el enlace ya esta en marcadores y en
 * pantallas viejas; borrarla daria 404 sin explicar a donde se fue.
 */
export default async function InformacionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/panel/asistente/${id}/general`);
}
