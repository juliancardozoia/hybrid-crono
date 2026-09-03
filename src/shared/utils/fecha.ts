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

/**
 * Hora de pared + huso -> instante exacto (ISO en UTC).
 *
 * POR QUE HACE FALTA
 *
 * Un `<input type="datetime-local">` devuelve "2026-03-14T20:55" sin ninguna
 * zona: es hora de pared. Guardarla directo como timestamptz la interpreta en
 * UTC, asi que una largada a las 20:55 en Bogota quedaria guardada cinco horas
 * antes de lo que el organizador quiso decir.
 *
 * El calculo del offset se hace preguntandole a Intl que hora es, EN ESA ZONA,
 * en un instante candidato. La diferencia entre esa hora y la que queriamos es
 * el offset. Se itera una segunda vez porque cerca de un cambio de horario de
 * verano el primer candidato puede caer del lado equivocado.
 */
export function instanteEnZona(fechaHoraLocal: string, timezone: string): string | null {
  const m = fechaHoraLocal
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const [, y, mes, d, h, min, seg] = m.map(Number) as unknown as number[];

  // Sin este chequeo, "2026-13-45T99:99" pasa el regex y Date.UTC lo desborda
  // silenciosamente hasta 2027: el organizador veria su competencia un año
  // corrida en vez de un error.
  if (mes < 1 || mes > 12 || d < 1 || d > 31 || h > 23 || min > 59 || (seg || 0) > 59) {
    return null;
  }

  const deseado = Date.UTC(y, mes - 1, d, h, min, seg || 0);

  // Y esto atrapa el 30 de febrero, que si esta dentro de los rangos de arriba.
  const control = new Date(deseado);
  if (control.getUTCMonth() !== mes - 1 || control.getUTCDate() !== d) return null;

  let instante = deseado;
  for (let i = 0; i < 2; i++) {
    instante = deseado - offsetDeZona(instante, timezone);
  }

  return new Date(instante).toISOString();
}

/** Cuantos ms adelantada esta la zona respecto de UTC en ese instante. */
function offsetDeZona(instante: number, timezone: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instante));

  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  // hour12:false puede devolver 24 en la medianoche de algunos runtimes.
  const hora = v("hour") % 24;

  const comoUtc = Date.UTC(v("year"), v("month") - 1, v("day"), hora, v("minute"), v("second"));
  return comoUtc - instante;
}

/**
 * Instante -> hora de pared en el huso, en el formato que come un
 * `<input type="datetime-local">`. Es la vuelta de instanteEnZona.
 */
export function paraInputLocal(iso: string | null, timezone: string): string {
  if (!iso) return "";

  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));

  const v = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  const hora = String(Number(v("hour")) % 24).padStart(2, "0");

  return `${v("year")}-${v("month")}-${v("day")}T${hora}:${v("minute")}`;
}
