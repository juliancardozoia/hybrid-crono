/**
 * Kilos y libras.
 *
 * El peso se guarda SIEMPRE en kilos: es la unidad canonica del deporte fuera de
 * Estados Unidos, la que usa el resto del esquema (`load_kg` en cuatro tablas) y
 * la que compara el motor de puntuacion. Guardar el numero tal cual con su
 * unidad al lado obligaria a convertir en cada lectura y a acordarse siempre.
 *
 * Pero se recuerda en que unidad lo escribio el organizador, y por eso estas dos
 * funciones son una sola cosa con dos direcciones: quien programo "95 lb" —el
 * numero redondo del reglamento— tiene que ver "95 lb" de vuelta, no "43,09 kg".
 *
 * El factor es el exacto de la libra avoirdupois, no una aproximacion: con 2,2
 * un round-trip de 95 lb devuelve 94,6 y el numero deja de ser el del
 * reglamento.
 */

const KG_POR_LIBRA = 0.45359237;

export function aKilos(valor: number, unidad: "kg" | "lb"): number {
  const kg = unidad === "lb" ? valor * KG_POR_LIBRA : valor;
  // Dos decimales, que es lo que acepta la columna `numeric(7,2)`.
  return Math.round(kg * 100) / 100;
}

export function desdeKilos(kg: number, unidad: "kg" | "lb"): number {
  if (unidad === "kg") return Math.round(kg * 100) / 100;
  // A libras se redondea al entero: los pesos en libras del reglamento siempre
  // lo son (95, 135, 155) y mostrar "95,00 lb" es ruido.
  return Math.round(kg / KG_POR_LIBRA);
}

/** "43 kg" o "95 lb", ya en la unidad en la que se cargo. */
export function formatearCarga(kg: number | null, unidad: "kg" | "lb"): string | null {
  if (kg === null) return null;
  const valor = desdeKilos(kg, unidad);
  // Sin decimales cuando es entero: "43 kg" y no "43,00 kg".
  const texto = Number.isInteger(valor) ? String(valor) : valor.toFixed(2).replace(/0$/, "");
  return `${texto} ${unidad}`;
}
