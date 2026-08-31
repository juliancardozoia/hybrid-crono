/**
 * Parser de CSV.
 *
 * Escrito a mano en vez de traer una dependencia porque el caso es acotado y
 * conocido: planillas que el organizador exporta de Excel o Google Sheets.
 * Contempla lo que esas planillas realmente traen y suele romper a los parsers
 * ingenuos hechos con split(","): comillas, comas adentro de un campo, saltos de
 * linea adentro de una celda, BOM de Excel y separador punto y coma.
 */

const BOM = "\u{FEFF}";
const DIACRITICOS = /[̀-ͯ]/g;

/** Excel guarda CSV con separador `;` en locales que usan coma decimal. */
function detectDelimiter(text: string): string {
  const corte = text.indexOf("\n");
  const primeraLinea = corte === -1 ? text : text.slice(0, corte);

  const comas = (primeraLinea.match(/,/g) ?? []).length;
  const puntoYComa = (primeraLinea.match(/;/g) ?? []).length;
  const tabs = (primeraLinea.match(/\t/g) ?? []).length;

  if (tabs > comas && tabs > puntoYComa) return "\t";
  return puntoYComa > comas ? ";" : ",";
}

/** Devuelve las filas del CSV como arreglos de celdas, sin interpretar nada. */
export function parseCsv(input: string): string[][] {
  // El BOM que antepone Excel, si no se saca, se pega al primer encabezado y
  // hace que "nombre" no matchee nunca.
  const sinBom = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  const text = sinBom.replace(/\r\n?/g, "\n");

  if (text.trim() === "") return [];

  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // comilla escapada dentro de un campo entrecomillado
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);

  // Filas totalmente vacias: cola del archivo o separadores entre bloques.
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Normaliza un encabezado: sin tildes, minusculas, guiones bajos. */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Igual que normalizeHeader pero para comparar valores (nombres de division). */
export function normalizeValue(value: string): string {
  return value.normalize("NFD").replace(DIACRITICOS, "").trim().toLowerCase();
}

/**
 * Convierte el CSV en objetos usando la primera fila como encabezado.
 *
 * Las claves quedan normalizadas para poder mapearlas sin depender de como el
 * organizador escribio "Fecha de Nacimiento".
 */
export function parseCsvToRecords(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);

  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
}
