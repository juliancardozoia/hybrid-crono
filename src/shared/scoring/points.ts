/**
 * La curva de puntos y como se adapta al tamano real de cada categoria.
 *
 * HAY UN SOLO SISTEMA DE PUNTUACION Y ES DINAMICO. Antes convivian cuatro
 * tablas fijas (CF-Games 40, CF-Games 80, CF-Open, Tiempo total) y el
 * organizador elegia una por categoria. Se borraron las tres primeras a
 * proposito: una tabla de 40 puestos aplicada a una categoria de 44 atletas
 * dejaba a los puestos 41-44 empatados en cero EN SILENCIO, y una de 80
 * aplicada a 12 atletas hacia que el ultimo saliera con 156 puntos, casi lo
 * mismo que el primero. Elegir la tabla "correcta" era una decision que el
 * organizador no tiene por que tomar y que no tiene respuesta buena cuando el
 * field no mide exactamente 40 u 80.
 *
 * `TABLA_TIEMPO_TOTAL` sobrevive pero NO es elegible: es el modo de una
 * carrera hibrida, donde no hay puntos que repartir porque el resultado ES el
 * tiempo del circuito. Ver `tablaDeCategoria`.
 */

import type { ScoringTable, ScoreDir } from "./types";

/**
 * Curva de referencia: CrossFit Games 2026, individuales, field de 30.
 *
 * Se escribe LITERAL y no generada por formula aunque la formula existe (de a
 * 4 hasta el puesto 14, de a 3 hasta el 20, de a 3 hasta el 30). La razon es
 * practica: un organizador la audita fila por fila contra la oficial antes de
 * competir, y una formula no se audita. Hay un test que verifica que la
 * literal coincida con la formula, asi que un dedazo al transcribir no pasa.
 */
export const GAMES_2026: readonly number[] = [
  100, 96, 92, 88, 84, 80, 76, 72, 68, 64,
  60, 56, 52, 48, 45, 42, 39, 36, 33, 30,
  27, 24, 21, 18, 15, 12, 9, 6, 3, 0,
];

/** Cuantos puestos tiene la curva de referencia. */
export const FIELD_DE_REFERENCIA = GAMES_2026.length;

/** Lo que vale una prueba por defecto. El organizador puede pesarla distinto. */
export const PUNTOS_MAXIMOS_POR_DEFECTO = 100;

/**
 * Decimales con los que se materializa la tabla.
 *
 * TRES, no dos ni cero. Con dos, dos puestos consecutivos de un field grande
 * pueden caer en el mismo valor redondeado y empatar a dos atletas que no
 * empataron en nada; con cero se pierde la forma de la curva entera. Tres
 * separa puestos consecutivos hasta fields de varios miles, que es mas de lo
 * que cualquier competencia real necesita. Es tambien la precision de las
 * columnas de la base (`numeric(9,3)`), a proposito: si el codigo redondeara
 * distinto que Postgres, el podio dependeria de cual de los dos leyo cada
 * pantalla.
 */
export const DECIMALES = 3;

function redondear(valor: number): number {
  const factor = 10 ** DECIMALES;
  return Math.round(valor * factor) / factor;
}

/**
 * Hyrox y cualquier competencia de una sola prueba por tiempo.
 *
 * `points` vacio significa que los puntos SON la posicion y gana quien menos
 * suma. Con una sola parte el orden por puntos ES el orden de esa parte, asi
 * que una carrera entra al mismo motor sin necesitar uno propio.
 */
export const TABLA_TIEMPO_TOTAL: ScoringTable = {
  id: "tiempo_total",
  name: "Tiempo total",
  points: [],
  dir: "menor_gana",
};

/**
 * Proyecta un puesto real sobre la curva de referencia.
 *
 * Con `N` atletas, el puesto `P` se estira o se comprime hasta caer dentro de
 * los 30 puestos de la curva:
 *
 *     equivalente = 1 + (P - 1) * (30 - 1) / (N - 1)
 *
 * El primero siempre cae en 1 (100 puntos) y el ultimo siempre en 30 (0
 * puntos), tenga la categoria 8 atletas o 200. Normalmente da un decimal, y
 * ahi se interpola linealmente entre los dos puestos vecinos de la curva.
 */
function puntosEnLaCurva(posicion: number, fieldSize: number): number {
  if (fieldSize <= 1) return GAMES_2026[0];

  const equivalente =
    1 + ((posicion - 1) * (FIELD_DE_REFERENCIA - 1)) / (fieldSize - 1);

  const bajo = Math.floor(equivalente);
  const alto = Math.ceil(equivalente);

  // Indices 0-based: el puesto `p` es GAMES_2026[p - 1].
  const valorBajo = GAMES_2026[bajo - 1];
  if (bajo === alto) return valorBajo;

  const valorAlto = GAMES_2026[alto - 1];
  const fraccion = equivalente - bajo;
  return valorBajo + fraccion * (valorAlto - valorBajo);
}

/**
 * La tabla de puntos de una categoria de `fieldSize` atletas.
 *
 * Un solo atleta se lleva el maximo: la regla "el ultimo saca cero" no puede
 * aplicarse a alguien que ademas es el primero, y darle cero al unico
 * participante seria absurdo.
 */
export function puntosDinamicos(
  fieldSize: number,
  maxPoints: number = PUNTOS_MAXIMOS_POR_DEFECTO,
): number[] {
  const n = Math.max(1, Math.floor(fieldSize));
  const escala = maxPoints / 100;

  return Array.from({ length: n }, (_, i) =>
    redondear(puntosEnLaCurva(i + 1, n) * escala),
  );
}

/** La misma curva, ya envuelta como tabla del motor. */
export function tablaDinamica(
  fieldSize: number,
  maxPoints: number = PUNTOS_MAXIMOS_POR_DEFECTO,
): ScoringTable {
  return {
    id: "games_2026_dynamic",
    name: "Games 2026 Dynamic",
    points: puntosDinamicos(fieldSize, maxPoints),
    dir: "mayor_gana",
  };
}

/**
 * Escala una tabla ya materializada al peso de una prueba.
 *
 * El snapshot se guarda SIEMPRE normalizado a 100 y el peso de cada prueba se
 * aplica al leerlo. Guardar un snapshot por prueba multiplicaria las filas por
 * la cantidad de WODs sin agregar informacion: la forma de la curva es la
 * misma, solo cambia la escala.
 */
export function escalarTabla(tabla: ScoringTable, maxPoints: number): ScoringTable {
  if (maxPoints === PUNTOS_MAXIMOS_POR_DEFECTO || tabla.points.length === 0) return tabla;
  const escala = maxPoints / 100;
  return { ...tabla, points: tabla.points.map((p) => redondear(p * escala)) };
}

/**
 * LA decision de que tabla le toca a una categoria. Un solo lugar.
 *
 * La usan los dos consumidores —el cache del servidor (`standings.ts`) y el
 * leaderboard en vivo (`buildScoreboard`)— y por eso vive aca y no en
 * ninguno de los dos: si cada uno resolviera la tabla a su manera, el podio
 * del panel y el que ve el atleta podrian diferir.
 *
 * El `snapshot` es la tabla CONGELADA de la categoria. Mientras no exista, se
 * calcula al vuelo con el field actual — util para previsualizar antes de
 * competir, pero se mueve si alguien se inscribe o se retira. Por eso se
 * bloquea al arrancar: ver `scoring_snapshots`.
 */
export function tablaDeCategoria(params: {
  formato: string;
  /** La tabla congelada, normalizada a 100. Null si todavia no se genero. */
  snapshot: readonly number[] | null;
  /** Atletas de la categoria AHORA. Solo se usa si no hay snapshot. */
  fieldSize: number;
}): ScoringTable {
  // Una carrera se gana llegando antes: no hay puestos que convertir en
  // puntos, y el leaderboard muestra el tiempo. El motor la trata como
  // "los puntos son la posicion" para que una hibrida y un CrossFit entren
  // por el mismo camino.
  if (params.formato === "carrera_hibrida") return TABLA_TIEMPO_TOTAL;

  if (params.snapshot && params.snapshot.length > 0) {
    return {
      id: "games_2026_dynamic",
      name: "Games 2026 Dynamic",
      points: params.snapshot,
      dir: "mayor_gana",
    };
  }

  return tablaDinamica(params.fieldSize);
}

/**
 * Puntos que le tocan a una posicion.
 *
 * Fuera del rango de la tabla se repite el ultimo valor. Con la tabla dinamica
 * eso solo puede pasar si alguien se INSCRIBIO despues de bloquear el
 * snapshot: los que entran de mas comparten el ultimo valor (cero) en vez de
 * mover la curva de todos los demas hacia atras, que es exactamente lo que el
 * snapshot existe para impedir.
 */
export function pointsForPosition(table: ScoringTable, position: number): number {
  if (position < 1) return 0;
  // Tabla sin valores: los puntos son la posicion (una carrera por tiempo).
  if (table.points.length === 0) return position;
  const index = Math.min(position, table.points.length) - 1;
  return table.points[index];
}

/** Hacia donde gana la suma de puntos de la tabla. */
export function pointsDirection(table: ScoringTable): ScoreDir {
  return table.dir;
}
