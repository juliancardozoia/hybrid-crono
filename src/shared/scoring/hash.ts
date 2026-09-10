/**
 * La huella de un standing: detecta si el leaderboard cambio entre que el
 * organizador lo miro y el momento en que confirma un corte.
 *
 * El problema que resuelve: la pantalla de corte muestra un ranking, el
 * organizador lo revisa, y ANTES de que apriete "Confirmar" alguien carga un
 * score desde otra pestana. Si la accion de confirmar recalculara en ese
 * instante, congelaria una seleccion que el organizador nunca llego a ver.
 *
 * La pantalla manda la huella de lo que mostro; el servidor recalcula fresco
 * y compara. Si difieren, rechaza con un mensaje que pide revisar de nuevo --
 * nunca corta "a ciegas" sobre datos que ya no describen la competencia.
 */

export type EntradaParaHuella = {
  teamId: string;
  position: number;
  totalPoints: number;
};

/**
 * FNV-1a de 32 bits. Sin dependencias, identico en cliente y servidor -- lo
 * unico que hace falta para comparar "es la misma lista" en las dos puntas.
 * No es criptografico, y no necesita serlo: nadie tiene incentivo para
 * fabricar una colision, solo hace falta detectar un cambio real.
 */
function fnv1aHex(texto: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * La huella de un standing completo.
 *
 * Ordenado por `teamId` ANTES de serializar, para que el resultado no
 * dependa del orden de iteracion de donde salio la lista (un `Map`, un
 * `.sort()` por posicion, etc): dos llamadas con las MISMAS entradas, en
 * cualquier orden, dan la MISMA huella.
 *
 * `totalPoints.toFixed(3)` (no el numero crudo) es lo que hace que
 * 174.222 y 174.22199999999998 -- el mismo valor con dos representaciones de
 * punto flotante -- produzcan la misma huella. Es la misma precision que ya
 * usan las columnas de Postgres (`numeric(9,3)`).
 */
export function huellaDelStanding(entradas: readonly EntradaParaHuella[]): string {
  const ordenadas = [...entradas].sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));
  const texto = ordenadas
    .map((e) => `${e.teamId}:${e.position}:${e.totalPoints.toFixed(3)}`)
    .join("|");
  return fnv1aHex(texto);
}
