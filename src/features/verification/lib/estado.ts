import type { QueueRow } from "../queries";

/**
 * Un carril esta PENDIENTE DE VERIFICAR cuando ya termino de correr y todavia
 * nadie de la organizacion le puso el visto.
 *
 * "Ya termino" es la parte que importa: un carril en curso tambien esta sin
 * verificar, pero contarlo seria ruido —no hay nada que revisar hasta que el
 * atleta cruce la meta—. Lo que este numero responde es "cuanto me falta para
 * poder publicar".
 *
 * Vive aca y no en cada pantalla para que la torre de control y la pantalla de
 * resultados no puedan mostrar numeros distintos de lo mismo.
 */
export function estaPendienteDeVerificar(fila: QueueRow): boolean {
  const termino = fila.status === "finished" || fila.status === "dnf" || fila.status === "dq";
  return termino && !fila.verified;
}
