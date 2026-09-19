/**
 * La geometria de la linea de tiempo del circuito: donde va cada estacion y
 * como se curva el recorrido para volver de una fila a la siguiente.
 *
 * POR QUE SERPENTINA Y NO UNA FILA SOLA
 *
 * Un circuito tipo Hyrox son 16 segmentos. En una sola fila, o se desborda a
 * scroll horizontal —y el organizador pierde de vista donde esta el atleta
 * justo cuando lo esta mirando— o cada estacion queda en 40px y no entra el
 * nombre. En columna es peor: 16 filas por atleta y la pantalla entera es
 * scroll. Serpenteando se usa el ANCHO, que es lo que sobra en el panel, y
 * todo el recorrido entra sin desplazarse.
 *
 * Es matematica pura y vive aparte del componente a proposito: la vuelta en U
 * cambia de lado segun la paridad de la fila, y eso se prueba con numeros en
 * vez de a ojo contra un SVG.
 */

/** Alto y ancho de la caja de una estacion, y el paso entre una y otra. */
export const CAJA_ANCHO = 116;
export const CAJA_ALTO = 56;
const PASO_X = CAJA_ANCHO + 76;
const PASO_Y = CAJA_ALTO + 62;
/** Cuanto se abre la curva hacia afuera al cambiar de fila. */
const CURVA = 80;
const MARGEN_X = 80;
const MARGEN_Y = 16;
/** Espacio bajo la ultima fila para el tiempo que va debajo de cada caja. */
const PIE = 24;

export interface CajaDeEstacion {
  indice: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export interface ConectorDeEstacion {
  /** El segmento del que SALE. Es el que decide si el tramo ya se recorrio. */
  desde: number;
  d: string;
}

export interface Serpentina {
  columnas: number;
  filas: number;
  ancho: number;
  alto: number;
  cajas: CajaDeEstacion[];
  conectores: ConectorDeEstacion[];
  /** Donde entra la linea de largada y donde sale la de meta. */
  largada: { x: number; y: number };
  meta: { x: number; y: number };
}

/**
 * Cuantas estaciones por fila.
 *
 * SEIS ES EL TECHO, y no es arbitrario: el SVG se escala al ancho del panel,
 * asi que cuantas mas columnas entren, mas chico queda el nombre de cada
 * estacion. Con seis, un circuito de 16 queda en tres filas y el texto se lee;
 * con ocho quedaria en dos, mas compacto y con los nombres al limite de lo
 * ilegible. Se reparte parejo (`total / filas`) para que ninguna fila quede
 * casi vacia y se lea como si el atleta hubiera abandonado a mitad de camino.
 */
const MAX_COLUMNAS = 6;

export function columnasPara(total: number): number {
  if (total <= 1) return 1;
  return Math.ceil(total / Math.ceil(total / MAX_COLUMNAS));
}

export function disposicionSerpentina(total: number): Serpentina {
  const columnas = columnasPara(total);
  const filas = Math.max(Math.ceil(total / columnas), 1);

  const cajas: CajaDeEstacion[] = [];
  for (let i = 0; i < total; i++) {
    const fila = Math.floor(i / columnas);
    const columna = i % columnas;
    // Las filas impares se recorren al reves: es lo que hace que el recorrido
    // sea continuo en vez de saltar de la derecha al margen izquierdo.
    const visual = fila % 2 === 0 ? columna : columnas - 1 - columna;
    const x = MARGEN_X + visual * PASO_X;
    const y = MARGEN_Y + fila * PASO_Y;
    cajas.push({
      indice: i,
      x,
      y,
      cx: x + CAJA_ANCHO / 2,
      cy: y + CAJA_ALTO / 2,
    });
  }

  const conectores: ConectorDeEstacion[] = [];
  for (let i = 0; i < total - 1; i++) {
    const a = cajas[i];
    const b = cajas[i + 1];
    const mismaFila = a.y === b.y;

    if (mismaFila) {
      // Recta de borde a borde. El sentido depende de la paridad de la fila.
      const izquierda = Math.min(a.x, b.x) + CAJA_ANCHO;
      const derecha = Math.max(a.x, b.x);
      conectores.push({ desde: i, d: `M ${izquierda} ${a.cy} H ${derecha}` });
      continue;
    }

    // Cambio de fila: las dos cajas quedan en la misma columna visual, asi que
    // la curva sale por el costado y vuelve. Sale por la derecha cuando la
    // fila que termina se recorrio hacia la derecha (fila par).
    const porDerecha = Math.floor(i / columnas) % 2 === 0;
    const borde = porDerecha ? a.x + CAJA_ANCHO : a.x;
    const control = porDerecha ? borde + CURVA : borde - CURVA;
    conectores.push({
      desde: i,
      d: `M ${borde} ${a.cy} C ${control} ${a.cy}, ${control} ${b.cy}, ${borde} ${b.cy}`,
    });
  }

  const ultima = cajas[cajas.length - 1];
  // La ultima fila se recorrio hacia la derecha si su indice es par.
  const ultimaHaciaLaDerecha = (filas - 1) % 2 === 0;

  return {
    columnas,
    filas,
    ancho: MARGEN_X * 2 + (columnas - 1) * PASO_X + CAJA_ANCHO,
    alto: MARGEN_Y + (filas - 1) * PASO_Y + CAJA_ALTO + PIE,
    cajas,
    conectores,
    largada: { x: MARGEN_X, y: MARGEN_Y + CAJA_ALTO / 2 },
    // La meta sale por el lado por el que se recorrio la ultima fila.
    meta: ultima
      ? {
          x: ultimaHaciaLaDerecha ? ultima.x + CAJA_ANCHO : ultima.x,
          y: ultima.cy,
        }
      : { x: MARGEN_X, y: MARGEN_Y },
  };
}

/**
 * Parte el nombre de una estacion en las lineas que entran en su caja.
 *
 * Corta por palabra y no por caracter: "Burpee Broad Jump 80m" tiene que
 * quedar como "Burpee Broad / Jump 80m", no como "Burpee Broad J / ump 80m".
 * Lo que no entra se recorta con puntos suspensivos —el nombre completo va
 * igual en el `title` de la caja—.
 */
export function partirEtiqueta(nombre: string, maxPorLinea: number, maxLineas: number): string[] {
  const lineas: string[] = [];
  let actual = "";

  for (const palabra of nombre.trim().split(/\s+/)) {
    const propuesta = actual ? `${actual} ${palabra}` : palabra;
    if (propuesta.length <= maxPorLinea || !actual) {
      actual = propuesta;
      continue;
    }
    lineas.push(actual);
    actual = palabra;
    if (lineas.length === maxLineas) break;
  }

  if (lineas.length < maxLineas && actual) {
    lineas.push(actual);
  } else if (actual) {
    // Quedo texto afuera: se avisa en la ultima linea que hay mas.
    const ultima = lineas[lineas.length - 1];
    lineas[lineas.length - 1] = `${ultima.slice(0, maxPorLinea - 1)}…`;
  }

  return lineas.map((linea) =>
    linea.length <= maxPorLinea ? linea : `${linea.slice(0, maxPorLinea - 1)}…`,
  );
}
