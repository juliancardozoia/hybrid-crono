/**
 * Lectura del tiempo tal como lo escribe una persona.
 *
 * Vive fuera de actions.ts porque Next exige que TODO export de un archivo
 * "use server" sea una funcion async, y esta es pura y sincrona. De paso, asi
 * se puede testear sin levantar nada.
 */

/**
 * Acepta "12:34", "12:34.56", "1:02:03" o milisegundos sueltos.
 *
 * Un juez que transcribe una planilla escribe minutos y segundos, no
 * milisegundos. Devuelve null si no se entiende, para que la accion pueda
 * pedirlo de nuevo en vez de guardar un cero.
 */
export function tiempoAMs(bruto: string): number | null {
  const texto = bruto.trim();
  if (!texto) return null;

  if (/^\d+$/.test(texto)) return Number(texto);

  const match = texto.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;

  const [, horas, minutos, segundos, decimales] = match;
  const centesimas = decimales ? Number(decimales.padEnd(3, "0")) : 0;

  return (
    Number(horas ?? 0) * 3_600_000 +
    Number(minutos) * 60_000 +
    Number(segundos) * 1000 +
    centesimas
  );
}
