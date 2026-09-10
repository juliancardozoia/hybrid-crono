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

import type { ScoringTable, ScoreDir, TiePointPolicy } from "./types";

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

/**
 * Redondea a `DECIMALES` (3). Se exporta para que cualquier lugar que SUME
 * puntos ya calculados (un total, un acumulado entre etapas) pueda limpiar el
 * ruido de punto flotante de la suma -- 0.1 + 0.2 no da 0.3 en JS -- con la
 * MISMA precision que ya usan las columnas de Postgres (`numeric(9,3)`), en
 * vez de que cada sumador redondee a su manera.
 */
export function redondear(valor: number): number {
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
  // Una carrera no tiene empates de puntos que repartir -- points=[] hace que
  // pointsForPosition devuelva la posicion misma, y pointsForTiedGroup nunca
  // promedia una tabla vacia (ver su guard). El valor es irrelevante en la
  // practica, pero se fija en el reglamento oficial para no dejarlo indefinido.
  tiePolicy: "same_position_points",
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
  tiePolicy: TiePointPolicy = "same_position_points",
): ScoringTable {
  return {
    id: "games_2026_dynamic",
    name: "Games 2026 Dynamic",
    points: puntosDinamicos(fieldSize, maxPoints),
    dir: "mayor_gana",
    tiePolicy,
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
  /**
   * Como reparte un empate. Del snapshot si ya esta congelado (es la
   * autoridad, ver `scoring_snapshots.tie_point_policy`), o del evento
   * mientras se previsualiza. Default `same_position_points` para no
   * romper a ningun llamador que todavia no la conozca.
   */
  tiePolicy?: TiePointPolicy;
}): ScoringTable {
  const tiePolicy = params.tiePolicy ?? "same_position_points";

  // Una carrera se gana llegando antes: no hay puestos que convertir en
  // puntos, y el leaderboard muestra el tiempo. El motor la trata como
  // "los puntos son la posicion" para que una hibrida y un CrossFit entren
  // por el mismo camino. La politica de empate no le hace nada -- ver
  // TABLA_TIEMPO_TOTAL -- asi que la hibrida queda fuera de esta decision.
  if (params.formato === "carrera_hibrida") return TABLA_TIEMPO_TOTAL;

  if (params.snapshot && params.snapshot.length > 0) {
    return {
      id: "games_2026_dynamic",
      name: "Games 2026 Dynamic",
      points: params.snapshot,
      dir: "mayor_gana",
      tiePolicy,
    };
  }

  return tablaDinamica(params.fieldSize, PUNTOS_MAXIMOS_POR_DEFECTO, tiePolicy);
}

/**
 * Puntos que le tocan a una posicion.
 *
 * Fuera del rango de la tabla se repite el ultimo valor (clamp). Esto NO es
 * comportamiento previsto: es un ESTADO DEGRADADO. Solo puede pasar si el
 * field real crecio por encima del `field_size` que describe un snapshot ya
 * CONGELADO -- alguien se inscribio despues de bloquear la curva -- y en ese
 * caso los que entran de mas comparten el ultimo valor (cero) en silencio,
 * sin que el snapshot vuelva a describir al field que en verdad compite.
 *
 * El clamp se conserva porque la alternativa (indexar fuera de rango) da
 * `undefined` y de ahi `NaN`, que es peor. Pero el camino correcto es NO
 * llegar nunca a este estado: `detectarFieldMismatch` existe exactamente
 * para eso, y los consumidores (recompute, el corte, la publicacion oficial)
 * tienen que llamarlo ANTES de puntuar y bloquear si dispara, en vez de
 * confiar en que este clamp calle el problema.
 */
export function pointsForPosition(table: ScoringTable, position: number): number {
  if (position < 1) return 0;
  // Tabla sin valores: los puntos son la posicion (una carrera por tiempo).
  if (table.points.length === 0) return position;
  const index = Math.min(position, table.points.length) - 1;
  return table.points[index];
}

/**
 * Puntos que le tocan a un GRUPO empatado, segun la politica de la tabla.
 *
 * `same_position_points` (y cualquier grupo sin empate, `tiedWith <= 1`) es
 * EXACTAMENTE `pointsForPosition(table, position)` -- el comportamiento de
 * siempre, bit a bit. Con `average_occupied_positions`, el grupo reparte
 * equitativamente los puntos de las `tiedWith` posiciones que ocupa
 * (`position`, `position+1`, ..., `position+tiedWith-1`), redondeado a la
 * misma precision que el resto de la tabla.
 *
 * Un empate SOLO puede darse entre marcas del mismo `statusRank` -- ver
 * `compareComparable` -- asi que un grupo empatado es siempre HOMOGENEO: o
 * todos puntuan, o ninguno (un grupo de DNF nunca llega aca con puntos que
 * repartir, porque `rankPart` ya le da 0 antes de llamar a esta funcion).
 */
export function pointsForTiedGroup(
  table: ScoringTable,
  position: number,
  tiedWith: number,
): number {
  // Una carrera hibrida (points=[]) queda FUERA de esta regla siempre, sin
  // importar que tiePolicy traiga la tabla: los puntos son la posicion misma,
  // y promediar posiciones (en vez de puntos) inventaria un numero que no es
  // ni un puesto ni un puntaje. El guard vive aca, no solo en el default de
  // TABLA_TIEMPO_TOTAL, para que ningun llamador pueda romperlo por accidente.
  if (table.points.length === 0 || tiedWith <= 1 || table.tiePolicy === "same_position_points") {
    return pointsForPosition(table, position);
  }

  let suma = 0;
  for (let i = 0; i < tiedWith; i++) {
    suma += pointsForPosition(table, position + i);
  }
  return redondear(suma / tiedWith);
}

/** Hacia donde gana la suma de puntos de la tabla. */
export function pointsDirection(table: ScoringTable): ScoreDir {
  return table.dir;
}

/**
 * Un snapshot CONGELADO que ya no describe al field real.
 *
 * `actualFieldSize > snapshotFieldSize` es la unica direccion que importa:
 * el field solo puede CRECER despues de congelar por una inscripcion nueva
 * (`admin_create_registration` / `confirm_registration` no saben que hay un
 * snapshot bloqueado y no tienen por que saberlo). Que el field sea MENOR es
 * legitimo -- alguien se retiro -- y no dispara nada: un retirado sale del
 * padron en los dos consumidores (ver CLAUDE.md, "los equipos retirados no
 * entran al padron"), asi que reduce el field sin romper la curva congelada.
 */
export type FieldMismatch = {
  divisionId: string;
  stage: number;
  snapshotFieldSize: number;
  actualFieldSize: number;
};

/**
 * Detecta el mismatch de arriba. Pura: no consulta nada, solo compara los
 * dos numeros que ya trajo el llamador (el `field_size` del snapshot, y el
 * tamano real del padron elegible calculado con la MISMA regla en los dos
 * consumidores -- retirados fuera).
 */
export function detectarFieldMismatch(params: {
  divisionId: string;
  stage: number;
  snapshotFieldSize: number;
  actualFieldSize: number;
}): FieldMismatch | null {
  if (params.actualFieldSize <= params.snapshotFieldSize) return null;
  return { ...params };
}
