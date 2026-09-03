import { redirect } from "next/navigation";

/**
 * La ruta vieja de "mis inscripciones".
 *
 * Se conserva como redireccion y no se borra: es un enlace que la gente pudo
 * guardar en favoritos o que quedo en un correo. Las inscripciones ahora viven
 * dentro del perfil de competidor, junto a los datos y la foto, porque son la
 * misma mitad de la cuenta.
 */
export default function MisInscripcionesPage() {
  redirect("/cuenta");
}
