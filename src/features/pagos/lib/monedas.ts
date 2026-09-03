/**
 * Las monedas que se ofrecen al elegir la de una competencia.
 *
 * Vive aca y no adentro de `MonedaDelEvento` porque el paso del asistente
 * necesita la misma lista para su propio selector, sin form ni boton propio.
 * Repetirla en los dos lados es como una un dia queda con ocho monedas y la
 * otra con nueve.
 */
export const MONEDAS = [
  { codigo: "COP", nombre: "Peso colombiano" },
  { codigo: "MXN", nombre: "Peso mexicano" },
  { codigo: "ARS", nombre: "Peso argentino" },
  { codigo: "CLP", nombre: "Peso chileno" },
  { codigo: "PEN", nombre: "Sol peruano" },
  { codigo: "BRL", nombre: "Real brasileño" },
  { codigo: "UYU", nombre: "Peso uruguayo" },
  { codigo: "USD", nombre: "Dólar" },
  { codigo: "EUR", nombre: "Euro" },
] as const;
