import { redirect } from "next/navigation";

/**
 * La ruta vieja del perfil de competidor.
 *
 * Se conserva como redireccion, mismo criterio que `/mis-inscripciones`: un
 * enlace guardado en favoritos o compartido en un correo no puede terminar en
 * un 404. El perfil ahora vive en `/panel/perfil`, dentro del mismo layout
 * con barra lateral que el resto del panel.
 */
export default function CuentaPage() {
  redirect("/panel/perfil");
}
