/**
 * El codigo de error de los limites del plan.
 *
 * Las funciones y triggers de `20260901101500_planes_y_publicacion.sql` levantan
 * el SQLSTATE `PL001` en vez del `check_violation` generico. La diferencia
 * importa: el traductor de errores de cada feature convierte `23514` en "algun
 * valor esta fuera de rango", que es correcto para un CHECK roto y pesimo para
 * "esto es del plan Pro".
 *
 * Con un codigo propio, el mensaje del servidor se muestra tal cual —lo escribio
 * alguien pensando en el organizador— y la pantalla puede ofrecer el cambio de
 * plan al lado.
 */

export const CODIGO_DE_PLAN = "PL001";

export function esLimiteDePlan(error: { code?: string } | null | undefined): boolean {
  return error?.code === CODIGO_DE_PLAN;
}

/**
 * Traduce un error respetando los mensajes del plan.
 *
 * Se usa como envoltorio del `traducir` de cada feature: si es un limite del
 * plan gana el mensaje del servidor, y si no, el traductor de siempre.
 */
export function traducirConPlan(
  error: { code?: string; message?: string } | null,
  traducir: (error: { code?: string; message?: string } | null) => string,
): string {
  if (esLimiteDePlan(error)) return error?.message ?? "Esto es del plan Pro.";
  return traducir(error);
}
