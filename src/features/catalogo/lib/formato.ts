/**
 * Como se escriben las fechas de una competencia en el catalogo.
 *
 * TODO PASA POR EL HUSO DEL EVENTO, no por el de quien mira. Un atleta
 * argentino que mira una competencia en Bogota tiene que ver la hora de Bogota:
 * es la hora a la que va a tener que estar ahi. Es la misma regla que gobierna
 * la torre de control, y por la misma razon.
 *
 * EL RANGO LO ARMA `Intl`, NO NOSOTROS. Antes se componia a mano —"14 al 16 de
 * marzo"— contrayendo lo que se repite. Funcionaba en español y en ningun otro
 * idioma: el ingles pone el mes primero y separa el año con coma, y cada idioma
 * contrae distinto. `formatRange` sabe hacerlo en los tres, y de paso es una
 * regla menos que mantener.
 */

import { localeDeIntl } from "@/shared/i18n/diccionario";
import { IDIOMA_POR_DEFECTO, type Idioma } from "@/shared/i18n/idiomas";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * Los doce meses, para el selector del catalogo.
 *
 * Se ofrecen SIEMPRE los doce, aunque solo tres tengan competencias. Es un
 * vocabulario cerrado que todo el mundo conoce de memoria, y un selector al que
 * le faltan nueve se lee como un error de la pagina y no como "no hay nada en
 * julio". Con paises la regla es la contraria —solo los que existen— porque ahi
 * la lista completa no la conoce nadie.
 */
export const MESES_DEL_ANIO = MESES.map((nombre, i) => ({
  valor: i + 1,
  label: nombre[0].toUpperCase() + nombre.slice(1),
}));

/**
 * Normaliza los espacios finos que mete `Intl`.
 *
 * `formatRange` separa el guion con U+2009 THIN SPACE. Es tipograficamente
 * correcto y en la pantalla se ve igual que un espacio normal, pero es
 * INVISIBLE en el codigo: una expectativa de test escrita a mano nunca coincide
 * y el error dice "esperado X, recibido X" con las dos cadenas identicas a la
 * vista. Costo una vuelta entera averiguarlo.
 *
 * Se cambia por un espacio normal, que ademas hace predecible cualquier
 * comparacion o busqueda sobre estos textos.
 */
function espaciosNormales(texto: string): string {
  // Escrito con escapes a proposito: pegar los caracteres literales aqui
  // dejaria una clase de caracteres que se ve VACIA al leer el archivo.
  return texto.replace(/[\u2009\u202f\u00a0]/g, " ");
}

/** "14 de marzo de 2026", "14–16 de marzo de 2026", "March 14 – April 2, 2026". */
export function rangoDeFechas(
  desde: string | null,
  hasta: string | null,
  timezone: string,
  idioma: Idioma = IDIOMA_POR_DEFECTO,
  sinFecha = "Fecha por confirmar",
): string {
  if (!desde) return sinFecha;

  const formato = new Intl.DateTimeFormat(localeDeIntl(idioma), {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const a = new Date(desde);
  if (!hasta) return espaciosNormales(formato.format(a));

  const b = new Date(hasta);
  // Un evento de un dia suele traer fin el mismo dia unas horas despues.
  // `formatRange` con dos fechas iguales devuelve el rango repetido, asi que se
  // compara el dia ya formateado: es la unica forma de saber si son el mismo
  // dia EN EL HUSO DEL EVENTO sin volver a extraer las partes a mano.
  return espaciosNormales(
    formato.format(a) === formato.format(b) ? formato.format(a) : formato.formatRange(a, b),
  );
}

/** "14 mar", para la chapa sobre la imagen de la tarjeta. */
export function fechaCorta(iso: string, timezone: string, idioma: Idioma): string {
  const texto = new Intl.DateTimeFormat(localeDeIntl(idioma), {
    timeZone: timezone,
    day: "numeric",
    month: "short",
  }).format(new Date(iso));

  // El punto de "mar." sobra en una chapa de dos palabras.
  return espaciosNormales(texto).replace(/\.$/, "");
}

/**
 * Dias completos que faltan para una fecha, en el huso del EVENTO.
 *
 * Se comparan dias de calendario y no milisegundos: faltar "1 día" tiene que
 * significar "es mañana", no "faltan 23 horas". Restar timestamps y dividir por
 * 86.400.000 da 0 a las once de la noche de la vispera, que es justo cuando
 * alguien mira si todavia llega a inscribirse.
 */
export function diasHasta(iso: string | null, timezone: string): number | null {
  if (!iso) return null;

  const dia = (fecha: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(fecha);

  // `en-CA` da YYYY-MM-DD, que `Date.UTC` interpreta sin ambiguedad.
  const aUtc = (texto: string) => {
    const [a, m, d] = texto.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };

  const faltan = (aUtc(dia(new Date(iso))) - aUtc(dia(new Date()))) / 86_400_000;
  return Math.round(faltan);
}

/** "marzo 2026", para las opciones del filtro por mes. */
export function nombreDeMes(clave: string): string {
  const [anio, mes] = clave.split("-").map(Number);
  if (!anio || !mes || mes < 1 || mes > 12) return clave;
  return `${MESES[mes - 1]} ${anio}`;
}

/** Primer y ultimo dia del mes, en el formato que espera el filtro. */
export function rangoDelMes(clave: string): { desde: string; hasta: string } | null {
  const [anio, mes] = clave.split("-").map(Number);
  if (!anio || !mes || mes < 1 || mes > 12) return null;

  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dos = (n: number) => String(n).padStart(2, "0");

  return { desde: `${anio}-${dos(mes)}-01`, hasta: `${anio}-${dos(mes)}-${dos(ultimo)}` };
}
