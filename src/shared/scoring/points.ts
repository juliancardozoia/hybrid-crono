/**
 * Tablas de puntos y su resolucion.
 *
 * Las tablas se escriben LITERALES y no generadas por formula, aunque la
 * formula existe (puestos 1 a 10 explicitos, y de ahi en adelante -2 por
 * puesto). La razon es practica: un organizador audita esta tabla contra la
 * oficial fila por fila antes de una competencia, y una formula no se audita.
 * El test verifica que la literal y la formula coincidan, asi que un dedazo no
 * pasa.
 */

import type { ScoringTable, ScoreDir } from "./types";

/**
 * Sistema oficial de los Games hasta 40 competidores.
 *
 * Los primeros diez puestos bajan de a 6 y 4 a proposito: le da mucho mas peso
 * a ganar una prueba que a salir quinto, y eso obliga al que va primero a no
 * especular. Del puesto 11 en adelante baja de a 2 y llega a 0 en el 40.
 */
export const CF_GAMES_40: readonly number[] = [
  100, 94, 88, 84, 80, 76, 72, 68, 64, 60,
  58, 56, 54, 52, 50, 48, 46, 44, 42, 40,
  38, 36, 34, 32, 30, 28, 26, 24, 22, 20,
  18, 16, 14, 12, 10, 8, 6, 4, 2, 0,
];

/** La misma forma, al doble de escala y extendida a 80 puestos. */
export const CF_GAMES_80: readonly number[] = [
  200, 194, 188, 184, 180, 176, 172, 168, 164, 160,
  158, 156, 154, 152, 150, 148, 146, 144, 142, 140,
  138, 136, 134, 132, 130, 128, 126, 124, 122, 120,
  118, 116, 114, 112, 110, 108, 106, 104, 102, 100,
  98, 96, 94, 92, 90, 88, 86, 84, 82, 80,
  78, 76, 74, 72, 70, 68, 66, 64, 62, 60,
  58, 56, 54, 52, 50, 48, 46, 44, 42, 40,
  38, 36, 34, 32, 30, 28, 26, 24, 22, 20,
];

export const TABLA_CF_GAMES_40: ScoringTable = {
  id: "cf_games_40",
  name: "CF-Games 40",
  points: CF_GAMES_40,
  dir: "mayor_gana",
};

export const TABLA_CF_GAMES_80: ScoringTable = {
  id: "cf_games_80",
  name: "CF-Games 80",
  points: CF_GAMES_80,
  dir: "mayor_gana",
};

/**
 * Sistema del CrossFit Open: los puntos SON la posicion, gana quien menos suma.
 *
 * `points` vacio no es un olvido: es lo que expresa que la tabla no tiene tope.
 * Una tabla de 10000 filas seria el mismo dato escrito peor, y ademas el Open
 * no tiene limite de participantes.
 */
export const TABLA_CF_OPEN: ScoringTable = {
  id: "cf_open",
  name: "CF-Open",
  points: [],
  dir: "menor_gana",
};

/**
 * Hyrox y cualquier competencia de una sola prueba por tiempo.
 *
 * Es CF-Open con otro nombre, y eso no es casualidad: con una sola parte, el
 * orden por puntos ES el orden de esa parte, y un vector de desempate de un
 * solo elemento no puede desempatar nada que las posiciones no hayan
 * desempatado ya. Por eso Hyrox entra al mismo motor en vez de tener uno
 * propio.
 */
export const TABLA_TIEMPO_TOTAL: ScoringTable = {
  ...TABLA_CF_OPEN,
  id: "tiempo_total",
  name: "Tiempo total",
};

export const TABLAS_ESTANDAR: readonly ScoringTable[] = [
  TABLA_TIEMPO_TOTAL,
  TABLA_CF_GAMES_40,
  TABLA_CF_GAMES_80,
  TABLA_CF_OPEN,
];

/**
 * Puntos que le tocan a una posicion.
 *
 * Fuera del rango de la tabla se repite el ultimo valor. Es una decision de
 * producto, no un descuido: con 100 inscriptos y una tabla de 80, los puestos
 * 81 a 100 empatan en el ultimo valor. Que eso se vea es responsabilidad de la
 * validacion de configuracion del evento, que avisa antes de competir; el motor
 * no puede inventar puntos que la tabla no define.
 */
export function pointsForPosition(table: ScoringTable, position: number): number {
  if (position < 1) return 0;
  // Tabla sin valores: los puntos son la posicion (CF-Open).
  if (table.points.length === 0) return position;
  const index = Math.min(position, table.points.length) - 1;
  return table.points[index];
}

/** Hacia donde gana la suma de puntos de la tabla. */
export function pointsDirection(table: ScoringTable): ScoreDir {
  return table.dir;
}

/**
 * Construye una tabla a medida a partir de los puntos que cargo el organizador.
 * Se asume "mayor gana" salvo que la lista venga vacia, que es el caso Open.
 */
export function tablaPersonalizada(
  id: string,
  name: string,
  points: readonly number[],
): ScoringTable {
  return {
    id,
    name,
    points,
    dir: points.length === 0 ? "menor_gana" : "mayor_gana",
  };
}

/**
 * Resuelve la tabla que una categoria tiene configurada.
 *
 * La base guarda una CLAVE para las tablas estandar y los puntos solo para las
 * personalizadas. Es a proposito: si los valores de CF-Games estuvieran tambien
 * en Postgres, tarde o temprano difieren de los de este archivo y el podio
 * dependeria de cual de los dos leyo cada pantalla.
 */
export function resolverTabla(
  builtinKey: string | null,
  customPoints: readonly number[] | null,
  nombre = "Tabla del evento",
): ScoringTable {
  if (builtinKey) {
    const estandar = TABLAS_ESTANDAR.find((t) => t.id === builtinKey);
    if (estandar) return estandar;
  }
  if (customPoints && customPoints.length > 0) {
    return tablaPersonalizada(builtinKey ?? "personalizada", nombre, customPoints);
  }
  // Sin nada configurado, gana el menor tiempo: es lo que hacia el producto
  // antes de que existieran los puntos.
  return TABLA_TIEMPO_TOTAL;
}
