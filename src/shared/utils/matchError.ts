/**
 * Comparacion de mensajes de error de Postgres, insensible a tildes.
 *
 * POR QUE EXISTE
 *
 * Varias funciones de la base distinguen sus fallas por el texto del mensaje, no
 * solo por el codigo SQLSTATE: "el carril ya lo tomo otro juez" no es lo mismo
 * que "no perteneces a este evento", y las dos llegan como error generico.
 *
 * Comparar ese texto tal cual es fragil: al pasar los mensajes a espanol neutro
 * se agregaron tildes ("tomo" -> "tomó", "dueno" -> "dueño") y todas las
 * comparaciones dejaron de coincidir en silencio — el usuario pasaba de ver "ese
 * carril lo tomo otro juez" a ver "no se pudo tomar el carril".
 *
 * Normalizando de los dos lados, una tilde o una mayuscula no rompen nada.
 */

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** true si el mensaje contiene alguno de los fragmentos, ignorando tildes. */
export function errorIncluye(mensaje: string | null | undefined, ...fragmentos: string[]): boolean {
  if (!mensaje) return false;
  const limpio = normalizar(mensaje);
  return fragmentos.some((f) => limpio.includes(normalizar(f)));
}
