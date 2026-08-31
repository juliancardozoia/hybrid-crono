/**
 * Formateo de hora de reloj en el huso de la competencia.
 *
 * POR QUE EXISTE ESTE ARCHIVO
 *
 * `new Date(iso).toLocaleTimeString("es")` usa el huso de QUIEN FORMATEA. En una
 * pagina de servidor eso es el huso de Vercel, que es UTC. Un heat largado a las
 * 20:55 en Bogota se mostraba como "1:55" —del dia siguiente— en la torre de
 * control, que es la pantalla donde alguien mira el reloj para decidir cosas.
 *
 * El evento ya guarda su huso (`events.timezone`, por defecto America/Bogota)
 * porque una competencia pasa en un lugar concreto. Hay que usarlo siempre:
 * la hora correcta no es la del servidor ni la del navegador de quien mira, es
 * la del venue.
 *
 * Ojo: esto es para horas de RELOJ (a que hora largo el heat, cuando se publico
 * un resultado). El tiempo de carrera NO pasa por aca: eso es `elapsedMs` y se
 * formatea con `formatElapsed`, sin husos ni calendarios de por medio.
 */

/** Hora del dia, con segundos. Para la torre de control. */
export function horaEnEvento(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("es", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Fecha y hora corta. Para largadas programadas y publicaciones. */
export function fechaHoraEnEvento(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString("es", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
