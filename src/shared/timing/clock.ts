/**
 * Anclaje del cronometro.
 *
 * Nunca se guarda un contador que se va incrementando: se guarda EL ANCLA y el
 * elapsed se deriva en cada frame. Un contador acumulado se desincroniza si la
 * pestana se congela o el dispositivo suspende; un ancla no.
 *
 * La formula usa `performance.now()` (monotono, inmune a cambios de hora del
 * sistema) para el avance dentro de la sesion, y el reloj de pared solo para
 * reconstruir el punto de partida despues de un reload.
 */

export type AnchorSource = "server" | "device_offline";

export interface ClockAnchor {
  laneId: string;
  /** Largada del heat en epoch ms. Del servidor si habia red al arrancar. */
  heatStartEpochMs: number;
  /** Offset de largada de este carril (0 en largada masiva, >0 si es escalonada). */
  startOffsetMs: number;
  /** Date.now() en el instante en que se capturo el ancla localmente. */
  capturedEpochMs: number;
  /** performance.now() en el MISMO instante que capturedEpochMs. */
  capturedPerfMs: number;
  source: AnchorSource;
}

export interface ClockNow {
  perfMs: number;
  epochMs: number;
}

/** Captura el par (perf, epoch) en el mismo instante. */
export function readClock(): ClockNow {
  return { perfMs: performance.now(), epochMs: Date.now() };
}

export function createAnchor(params: {
  laneId: string;
  heatStartEpochMs: number;
  startOffsetMs?: number;
  source: AnchorSource;
  now?: ClockNow;
}): ClockAnchor {
  const now = params.now ?? readClock();
  return {
    laneId: params.laneId,
    heatStartEpochMs: params.heatStartEpochMs,
    startOffsetMs: params.startOffsetMs ?? 0,
    capturedEpochMs: now.epochMs,
    capturedPerfMs: now.perfMs,
    source: params.source,
  };
}

/**
 * Elapsed del carril en este instante.
 *
 * elapsed = (avance monotono desde la captura) + (elapsed que ya habia en la captura)
 *
 * El primer termino solo usa performance.now(), asi que cambiar la hora del
 * sistema a mitad de carrera no altera el cronometro.
 */
export function elapsedFromAnchor(anchor: ClockAnchor, nowPerfMs: number): number {
  const sinceCapture = nowPerfMs - anchor.capturedPerfMs;
  const elapsedAtCapture =
    anchor.capturedEpochMs - anchor.heatStartEpochMs - anchor.startOffsetMs;
  return Math.max(0, sinceCapture + elapsedAtCapture);
}

/**
 * Re-ancla despues de un reload.
 *
 * `performance.now()` arranca de cero en cada documento nuevo, asi que el
 * `capturedPerfMs` persistido no sirve mas. Reconstruimos el elapsed desde el
 * reloj de pared una sola vez y volvemos a anclar contra el nuevo timeline
 * monotono. Esto es lo que hace que refresh, reapertura del navegador y reboot
 * del celular devuelvan el tiempo correcto.
 */
export function rehydrateAnchor(
  persisted: ClockAnchor,
  now: ClockNow = readClock(),
): ClockAnchor {
  return {
    ...persisted,
    capturedEpochMs: now.epochMs,
    capturedPerfMs: now.perfMs,
  };
}

/**
 * Corrige el ancla cuando el servidor informa la largada real del heat.
 *
 * Caso tipico: el heat arranco sin senal y el juez marco el start en su
 * dispositivo; al volver la red, el servidor dice cual fue la largada oficial.
 * Devuelve el ancla corregida y de cuanto fue el ajuste, para poder auditarlo.
 */
export function reconcileAnchor(
  anchor: ClockAnchor,
  serverHeatStartEpochMs: number,
): { anchor: ClockAnchor; driftMs: number } {
  const driftMs = anchor.heatStartEpochMs - serverHeatStartEpochMs;
  return {
    anchor: {
      ...anchor,
      heatStartEpochMs: serverHeatStartEpochMs,
      source: "server",
    },
    driftMs,
  };
}

/**
 * Parte el tiempo en "lo que se lee de lejos" y "la precision".
 *
 * Para pantallas grandes: el proyector tiene que mostrar centesimas porque en
 * una competencia por tiempo deciden podios, pero a la misma altura que los
 * minutos compiten por atencion y hacen la fila mas dificil de leer a diez
 * metros. Renderizando `centis` mas chico se consigue lo mejor de los dos.
 *
 * elapsedParts(4365320) -> { main: "1:12:45", centis: "32" }
 */
export function elapsedParts(ms: number): { main: string; centis: string } {
  const completo = formatElapsed(ms);
  const corte = completo.lastIndexOf(".");
  return { main: completo.slice(0, corte), centis: completo.slice(corte + 1) };
}

/** Formatea a MM:SS.cc (o H:MM:SS.cc si pasa la hora). Centesimas, como se muestra en Hyrox. */
export function formatElapsed(ms: number, opts?: { centis?: boolean }): string {
  const showCentis = opts?.centis ?? true;
  const clamped = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor((clamped % 1000) / 10);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const base = hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  return showCentis ? `${base}.${String(centis).padStart(2, "0")}` : base;
}
