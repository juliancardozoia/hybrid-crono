import "server-only";
import { after } from "next/server";
import { procesarCorreosPendientes } from "./servicio";

/**
 * Manda ahora lo que la accion acaba de encolar.
 *
 * El correo ya esta a salvo en la cola —el trigger lo escribio dentro de la
 * misma transaccion—; esto solo evita esperar al barrido de reintentos para que
 * la invitacion llegue en segundos. `after()` corre DESPUES de responder: el
 * usuario nunca espera al proveedor, y si el proveedor esta caido la accion no
 * falla, el correo queda pendiente y se reintenta.
 *
 * Se puede llamar sin miedo desde cualquier accion: si no hay nada en la cola
 * es una consulta vacia, y si estamos fuera de un request (un script, un test)
 * `after()` no aplica y simplemente no hace nada.
 */
export function dispararEnvioDeCorreos(): void {
  try {
    after(async () => {
      try {
        await procesarCorreosPendientes();
      } catch (error) {
        console.error("[correos] no se pudo procesar la cola:", (error as Error).message);
      }
    });
  } catch {
    // Fuera de un request scope. El barrido periodico lo recoge igual.
  }
}
