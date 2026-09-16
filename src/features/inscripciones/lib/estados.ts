import type { RegistrationStatus } from "@/lib/supabase/types";

/**
 * Traduccion visual de `registrations.status`. Antes vivia copiada tres veces
 * (panel del atleta, panel del tramite, vista del organizador) con el mismo
 * contenido y riesgo real de divergir -- ya habia divergido una vez (`"Lista
 * de espera"` vs `"En lista de espera"`). Un solo lugar de verdad.
 *
 * El TONO es lo compartido; cada pantalla decide si lo pinta como pastilla
 * (`claseDePastilla`) o como texto simple (`claseDeTexto`) segun su propio
 * lenguaje visual -- eso no estaba duplicado, era una decision legitima de
 * cada pantalla, y se conserva.
 */

export type TonoDeEstado = "neutral" | "ambar" | "lima" | "rojo";

export const ESTADOS_INSCRIPCION: Record<
  RegistrationStatus,
  { texto: string; tono: TonoDeEstado }
> = {
  borrador: { texto: "Sin enviar", tono: "neutral" },
  esperando_integrantes: { texto: "Faltan integrantes", tono: "ambar" },
  esperando_pago: { texto: "Falta pagar", tono: "ambar" },
  confirmada: { texto: "Confirmada", tono: "lima" },
  cancelada: { texto: "Cancelada", tono: "rojo" },
  lista_espera: { texto: "En lista de espera", tono: "neutral" },
};

const CLASE_PASTILLA: Record<TonoDeEstado, string> = {
  neutral: "bg-neutral-800 text-neutral-300",
  ambar: "bg-amber-400/15 text-amber-300",
  lima: "bg-lime-400/15 text-lime-300",
  rojo: "bg-red-500/15 text-red-300",
};

const CLASE_TEXTO: Record<TonoDeEstado, string> = {
  neutral: "text-neutral-500",
  ambar: "text-amber-400",
  lima: "text-lime-400",
  rojo: "text-red-400",
};

function entrada(status: RegistrationStatus | string) {
  return (
    ESTADOS_INSCRIPCION[status as RegistrationStatus] ?? {
      texto: status,
      tono: "neutral" as const,
    }
  );
}

export function textoDeEstado(status: RegistrationStatus | string): string {
  return entrada(status).texto;
}

export function claseDePastilla(status: RegistrationStatus | string): string {
  return CLASE_PASTILLA[entrada(status).tono];
}

export function claseDeTexto(status: RegistrationStatus | string): string {
  return CLASE_TEXTO[entrada(status).tono];
}

/**
 * `registration_readiness()`: si a esta inscripcion le falta algo, sea cual
 * sea el motivo. Es la señal que separa "confirmada" de "lista para
 * competir" -- pagar no es lo mismo que estar listo.
 */
export type Readiness = "incompleto" | "accion_requerida" | "listo";

/**
 * El mensaje combinado que pide el rediseño: "PAGADO no significa LISTO".
 *
 * Solo tiene algo que decir una vez que la inscripcion esta `confirmada` --
 * antes de eso, el estado de `registrations.status` (badge de arriba) ya
 * cuenta toda la historia ("falta pagar", "faltan integrantes"). Devuelve
 * `null` cuando no hay nada mas que agregar, para que el llamador decida si
 * mostrar el badge nomas o el badge + este mensaje.
 */
export function mensajeDeReadiness(
  status: RegistrationStatus | string,
  readiness: Readiness,
): string | null {
  if (status !== "confirmada") return null;
  if (readiness === "listo") return "Listo para competir";
  if (readiness === "accion_requerida") return "Inscrito — completa tus datos";
  return null;
}
