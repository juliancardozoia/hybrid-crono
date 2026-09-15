import { redirect } from "next/navigation";

/**
 * La ruta vieja de "mis inscripciones".
 *
 * Se conserva como redireccion y no se borra: es un enlace que la gente pudo
 * guardar en favoritos o que quedo en un correo. Las inscripciones ahora viven
 * en "Compito", dentro de `/panel` -- el punto de entrada unico de la cuenta.
 */
export default function MisInscripcionesPage() {
  redirect("/panel");
}
