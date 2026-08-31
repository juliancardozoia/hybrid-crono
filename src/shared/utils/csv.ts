/**
 * Serializacion a CSV.
 *
 * Escrita a mano y testeada porque escapar mal es el error clasico: un nombre
 * con coma ("Perez, Juan") o una observacion con comillas parten el archivo en
 * columnas equivocadas, y el organizador se entera cuando ya publico el podio.
 */

/** Escapa una celda segun RFC 4180. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const texto = String(value);
  // Comillas, separadores y saltos de linea obligan a entrecomillar. El punto y
  // coma tambien, porque Excel en locales con coma decimal lo usa de separador.
  if (/["\n\r,;\t]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lineas = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];

  // CRLF por RFC 4180, y BOM para que Excel abra los acentos bien en vez de
  // mostrar "Perez GonzÃ¡lez".
  return "\u{FEFF}" + lineas.join("\r\n") + "\r\n";
}
