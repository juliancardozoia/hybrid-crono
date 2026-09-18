import type { ResumenDeInscripcion } from "../queries";

/**
 * Que inscripcion se destaca en el panel del atleta -- el widget grande con
 * el afiche, la cuenta regresiva y los resultados.
 *
 * Orden de prioridad: lo que esta pasando AHORA (en vivo o verificando
 * resultados) gana siempre, sea cual sea su fecha -- es lo mas urgente que
 * el atleta puede necesitar mirar. Si no hay nada en vivo, la proxima por
 * fecha. Si ya no queda ninguna por venir, la mas reciente que ya paso: hay
 * algo que mostrar en el widget principal en vez de dejarlo vacio.
 */
export function elegirDestacada(
  inscripciones: ResumenDeInscripcion[],
): ResumenDeInscripcion | null {
  if (inscripciones.length === 0) return null;

  const enVivo = inscripciones.find(
    (i) => i.eventStatus === "live" || i.eventStatus === "verifying",
  );
  if (enVivo) return enVivo;

  const ahora = Date.now();
  const proximas = inscripciones
    .filter((i) => i.startsAt && new Date(i.startsAt).getTime() >= ahora)
    .sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime());
  if (proximas.length > 0) return proximas[0];

  const pasadas = inscripciones
    .filter((i) => i.startsAt)
    .sort((a, b) => new Date(b.startsAt!).getTime() - new Date(a.startsAt!).getTime());
  if (pasadas.length > 0) return pasadas[0];

  return inscripciones[0];
}

/**
 * El orden del widget "Mis competencias": lo que esta pasando ahora o esta
 * por venir primero, lo que ya paso al final -- resalta lo vigente sin
 * esconder el historial, que sigue siendo parte de la lista.
 */
export function ordenarParaElListado(
  inscripciones: ResumenDeInscripcion[],
): ResumenDeInscripcion[] {
  const ahora = Date.now();

  function peso(i: ResumenDeInscripcion): 0 | 1 | 2 {
    if (i.eventStatus === "live" || i.eventStatus === "verifying") return 0;
    if (i.startsAt && new Date(i.startsAt).getTime() >= ahora) return 1;
    return 2;
  }

  return [...inscripciones].sort((a, b) => {
    const pa = peso(a);
    const pb = peso(b);
    if (pa !== pb) return pa - pb;

    const ta = a.startsAt ? new Date(a.startsAt).getTime() : 0;
    const tb = b.startsAt ? new Date(b.startsAt).getTime() : 0;
    // Las que ya pasaron: la mas reciente primero. Las demas: la mas
    // proxima primero.
    return pa === 2 ? tb - ta : ta - tb;
  });
}

/**
 * Si esta inscripcion ya paso (ni en vivo ni por venir). Vive aca y no en el
 * componente que la muestra: `Date.now()` adentro de un Server Component
 * dispara la regla de pureza de React (`react-hooks/purity`) -- un modulo
 * de funciones puras que ESE componente importa no cuenta como parte de su
 * render a ojos del linter, asi que la impureza queda confinada aca.
 */
export function yaPaso(i: ResumenDeInscripcion): boolean {
  if (i.eventStatus === "live" || i.eventStatus === "verifying") return false;
  return !i.startsAt || new Date(i.startsAt).getTime() < Date.now();
}
