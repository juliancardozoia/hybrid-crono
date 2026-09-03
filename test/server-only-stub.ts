/**
 * Reemplazo de `server-only` para los tests.
 *
 * El paquete real lanza en cuanto se importa fuera de un Server Component, y
 * vitest no es uno. Sin este stub, todo modulo marcado como solo-servidor
 * quedaria sin tests — justo los que tocan secretos y base de datos, que son
 * los que mas falta hacen probar.
 *
 * El alias vive SOLO en la config de tests: en el build real sigue corriendo el
 * paquete de verdad y la proteccion se mantiene.
 */
export {};
