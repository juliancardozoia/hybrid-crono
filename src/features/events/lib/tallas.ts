/**
 * Las tallas de remera que ofrece la UI.
 *
 * Vive fuera de actions.ts porque Next exige que TODO export de un archivo
 * "use server" sea una funcion async, y esto es una constante. Lo comparten el
 * formulario y la accion para que no se puedan desincronizar: si el formulario
 * ofreciera una talla que la accion no lee, el organizador la marcaria y no se
 * guardaria nada.
 */
export const TALLAS = ["XS", "S", "M", "L", "XL", "XXL"] as const;
