import type { Idioma } from "@/shared/i18n/idiomas";
import { renderizarCorreo } from "./plantillas";
import type { CorreoEnCola, MensajeDeCorreo, ResultadoDeEnvio } from "./tipos";

/**
 * El procesador de la cola, con sus dependencias inyectadas.
 *
 * Es una funcion sobre interfaces y no un modulo que importa Supabase y el
 * proveedor: asi la logica que importa —que un fallo no frene a los demas, que
 * un tipo desconocido no mande basura, que el resultado quede marcado siempre—
 * se prueba sin base ni red. El cableado real esta en `servicio.ts`.
 *
 * La politica de reintento (espera y tope de intentos) NO vive aca sino en
 * `interno_marcar_correo`, en Postgres: es lo que prueban los tests de base.
 */

export interface DependenciasDelProcesador {
  reclamar(limite: number): Promise<CorreoEnCola[]>;
  marcar(id: string, ok: boolean, error?: string): Promise<void>;
  idiomaDe(email: string, pista: unknown): Promise<Idioma>;
  enviar(mensaje: MensajeDeCorreo, idempotencia: string): Promise<ResultadoDeEnvio>;
  baseUrl: string;
  /** Espera entre envios. Resend admite ~2 por segundo: sin pausa, el lote se topa con 429. */
  pausaMs?: number;
  dormir?: (ms: number) => Promise<void>;
}

export interface ResumenDeProcesamiento {
  reclamados: number;
  enviados: number;
  fallidos: number;
}

const dormirDeVerdad = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function procesarCola(
  deps: DependenciasDelProcesador,
  limite = 20,
): Promise<ResumenDeProcesamiento> {
  const filas = await deps.reclamar(limite);
  const resumen: ResumenDeProcesamiento = { reclamados: filas.length, enviados: 0, fallidos: 0 };
  const dormir = deps.dormir ?? dormirDeVerdad;

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];

    try {
      const idioma = await deps.idiomaDe(fila.to_email, fila.payload?.locale_hint);
      const correo = renderizarCorreo(fila, idioma, deps.baseUrl);
      const resultado = await deps.enviar({ para: fila.to_email, ...correo }, fila.id);

      if (resultado.ok) {
        await deps.marcar(fila.id, true);
        resumen.enviados++;
      } else {
        await deps.marcar(fila.id, false, resultado.error);
        resumen.fallidos++;
      }
    } catch (error) {
      // Cualquier excepcion (plantilla, base, red) es de UN correo: el resto del
      // lote sigue. Si ni siquiera se puede marcar, la fila queda 'procesando' y
      // el reclamo por vencimiento de `interno_reclamar_correos` la recupera.
      resumen.fallidos++;
      try {
        await deps.marcar(fila.id, false, (error as Error).message);
      } catch {
        /* ver arriba */
      }
    }

    if (deps.pausaMs && i < filas.length - 1) await dormir(deps.pausaMs);
  }

  return resumen;
}
