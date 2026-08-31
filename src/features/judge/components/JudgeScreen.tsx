"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import { SUSPICIOUS_SPLIT_MS } from "@/shared/timing/reducer";
import type { PenaltyPayload, Segment } from "@/shared/timing/types";
import { startHeartbeat, UNDO_WINDOW_MS, useRaceStore } from "../lib/store";
import { startSyncLoop, supabaseTransport, type SyncOutcome, type Transport } from "../lib/sync";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { useWakeLock } from "../lib/useWakeLock";
import { LiveClock } from "./LiveClock";

export interface JudgeScreenProps {
  laneId: string;
  bib: string;
  athlete: string;
  /** Division y heat, para que el juez confirme que esta en el carril correcto. */
  subtitle?: string;
  segments: Segment[];
  penalties: PenaltyPayload[];
  /** Largada oficial del heat en epoch ms. null si todavia no largo. */
  heatStartEpochMs: number | null;
  startOffsetMs?: number;
  recordedBy?: string;
  transport?: Transport;
  /** Vuelve a consultar la largada al servidor. Devuelve epoch ms o null. */
  onCheckStart?: () => Promise<number | null>;
  /**
   * Cuando ofrecer la largada desde el dispositivo.
   * "offline": solo sin señal, porque la largada oficial la estampa el servidor.
   * "siempre": para el laboratorio del spike, donde no hay servidor que esperar.
   */
  localStart?: "offline" | "siempre" | "nunca";
  allowReset?: boolean;
}

export function JudgeScreen({
  laneId,
  bib,
  athlete,
  subtitle,
  segments,
  penalties,
  heatStartEpochMs,
  startOffsetMs = 0,
  recordedBy = "",
  transport = supabaseTransport,
  onCheckStart,
  localStart = "nunca",
  allowReset = false,
}: JudgeScreenProps) {
  const {
    anchor,
    result,
    pendingCount,
    storagePersisted,
    hydrated,
    undoTarget,
    anchorDriftMs,
    init,
    applyServerStart,
    startLocally,
    markSplit,
    applyPenalty,
    undoLast,
    finishWith,
    refreshPending,
    reset,
    currentElapsed,
  } = useRaceStore();

  const online = useOnlineStatus();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmFastSplit, setConfirmFastSplit] = useState(false);
  const [syncError, setSyncError] = useState<{ texto: string; fatal: boolean } | null>(null);

  const running = result?.status === "running";
  useWakeLock(running);

  useEffect(() => {
    void init({ laneId, segments, heatStartEpochMs, startOffsetMs, recordedBy });
  }, [init, laneId, segments, heatStartEpochMs, startOffsetMs, recordedBy]);

  const onSync = useCallback(
    (outcome: SyncOutcome) => {
      // Se muestra CUALQUIER error, no solo los fatales. Un contador de
      // pendientes que sube sin explicacion deja al juez sin saber si el
      // problema es la senal del venue o algo roto del lado del servidor — y a
      // la organizacion sin ninguna pista para diagnosticarlo.
      setSyncError(outcome.error ? { texto: outcome.error, fatal: Boolean(outcome.fatal) } : null);
      void refreshPending();
    },
    [refreshPending],
  );

  useEffect(() => {
    if (!hydrated) return;
    const stopSync = startSyncLoop(laneId, onSync, transport);
    const stopHeartbeat = startHeartbeat();
    return () => {
      stopSync();
      stopHeartbeat();
    };
  }, [hydrated, laneId, onSync, transport]);

  const checkStart = useCallback(async () => {
    const epoch = await onCheckStart?.();
    if (epoch !== null && epoch !== undefined) await applyServerStart(epoch);
  }, [onCheckStart, applyServerStart]);

  /**
   * Un tap simple marca, sin confirmacion: la velocidad importa mas que el
   * error, porque el error tiene deshacer. La unica excepcion es un marcaje
   * imposiblemente rapido, que casi siempre es un doble tap accidental.
   */
  const onMark = useCallback(() => {
    const last = result?.splits.at(-1);
    const delta = currentElapsed() - (last?.cumulativeMs ?? 0);
    if (result?.splits.length && delta < SUSPICIOUS_SPLIT_MS) {
      setConfirmFastSplit(true);
      return;
    }
    void markSplit();
    navigator.vibrate?.(40);
  }, [currentElapsed, markSplit, result]);

  if (!hydrated) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-neutral-500">
        <p className="text-lg">Cargando carril…</p>
      </main>
    );
  }

  const nextSegment = result?.nextSegmentIndex != null ? segments[result.nextSegmentIndex] : null;
  const finalStatus =
    result && (result.status === "finished" || result.status === "dnf" || result.status === "dq")
      ? result.status
      : null;

  return (
    <main className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-50 select-none">
      <div className="safe-top">
        <StatusBar online={online} pendingCount={pendingCount} persisted={storagePersisted} />
      </div>

      {/*
        El nombre del atleta es lo que el juez tiene que confirmar de un vistazo
        antes de cada marcaje: marcarle el parcial al carril equivocado es el
        error mas caro que puede cometer. Por eso va grande y en blanco, y el
        dorsal como chip de alto contraste.
      */}
      <header className="px-4 pt-4 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="rounded-lg bg-neutral-100 px-2.5 py-1 font-mono text-xl font-black text-neutral-950 tabular-nums">
                {bib}
              </span>
              {subtitle && (
                <span className="truncate text-xs text-neutral-500">{subtitle}</span>
              )}
            </div>
            <p className="mt-2 text-2xl leading-tight font-bold break-words">{athlete}</p>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-mono text-2xl font-bold tabular-nums">
              {result?.splits.length ?? 0}
              <span className="text-neutral-600">/{segments.length}</span>
            </p>
            <p className="text-[10px] tracking-wider text-neutral-600 uppercase">parciales</p>
          </div>
        </div>
      </header>

      {syncError && (
        <p
          className={`mx-4 mt-3 sm:mx-5 rounded-xl border p-3 text-sm ${
            syncError.fatal
              ? "border-red-500/40 bg-red-500/10 text-red-200"
              : "border-amber-500/40 bg-amber-500/10 text-amber-200"
          }`}
        >
          {syncError.texto}{" "}
          {syncError.fatal
            ? "Tus marcajes siguen guardados en este dispositivo; avisa a la organización."
            : "Los marcajes están guardados aquí y se reintentan solos."}
        </p>
      )}

      {anchorDriftMs !== null && anchorDriftMs !== 0 && (
        <p className="mx-4 mt-3 rounded-xl border border-sky-500/40 sm:mx-5 bg-sky-500/10 p-3 text-sm text-sky-200">
          El reloj se ajustó {formatElapsed(Math.abs(anchorDriftMs), { centis: false })} al llegar la
          salida oficial del heat. Tus parciales se corrigieron solos.
        </p>
      )}

      {!anchor ? (
        <EsperandoLargada
          online={online}
          localStart={localStart}
          // Sin onCheckStart no hay a quien preguntarle: es el caso del spike.
          onCheck={onCheckStart ? checkStart : null}
          onLocalStart={() => void startLocally()}
        />
      ) : (
        <>
          <section className="px-4 py-5 text-center sm:px-5 sm:py-6">
            <LiveClock
              anchor={anchor}
              frozenMs={finalStatus ? (result?.stoppedAtMs ?? 0) : null}
              className="font-mono text-[clamp(2.75rem,13vw,4.5rem)] leading-none font-bold tabular-nums"
            />
            {result && result.penaltyMs > 0 && (
              <p className="mt-2 font-mono text-lg text-amber-400 tabular-nums">
                +{formatElapsed(result.penaltyMs, { centis: false })} penalizacion
                {result.totalMs !== null && (
                  <span className="ml-2 text-neutral-400">= {formatElapsed(result.totalMs)}</span>
                )}
              </p>
            )}
          </section>

          {/* safe-bottom: sin esto el boton de marcar queda debajo de la barra
              de gestos del iPhone, que es justo donde el juez apoya el pulgar. */}
          <section className="safe-bottom flex flex-1 flex-col px-4 sm:px-5">
            {running && nextSegment && (
              <BigButton onClick={onMark}>
                <span className="text-lg font-medium opacity-70 sm:text-xl">SIGUIENTE ▸</span>
                <span className="mt-1 text-[clamp(1.6rem,7vw,2.5rem)] leading-tight font-black text-balance">
                  {nextSegment.name}
                </span>
                <span className="mt-3 text-sm opacity-60">
                  {result.nextSegmentIndex! + 1} de {segments.length}
                </span>
              </BigButton>
            )}

            {finalStatus && <FinishCard status={finalStatus} totalMs={result!.totalMs} />}

            {/*
              En el laboratorio, terminar una carrera tiene que dejarte empezar
              otra. El boton de reiniciar existia pero estaba pintado casi del
              color del fondo, escondido al pie de la pantalla: en la practica el
              spike quedaba inservible despues del primer uso.

              Solo aparece asi de visible cuando la carrera TERMINO. Con el
              cronometro corriendo el reinicio sigue siendo el enlace discreto
              del pie, porque ahi un toque accidental borraria una carrera real.
            */}
            {finalStatus && allowReset && (
              <button
                type="button"
                onClick={() => void reset()}
                className="mt-3 shrink-0 rounded-2xl border-2 border-lime-400 bg-lime-400/10 py-5 text-xl font-bold text-lime-300 transition-transform active:scale-[0.99] active:bg-lime-400/20"
              >
                PROBAR DE NUEVO
              </button>
            )}

            {running && (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="mt-3 shrink-0 rounded-2xl border border-amber-500/40 bg-amber-500/10 py-5 text-xl font-bold text-amber-300 active:bg-amber-500/20"
              >
                PENALIZAR
              </button>
            )}

            {/*
              Deshacer es la red de seguridad del tap sin confirmacion, y solo
              sirve si el juez la ve: contrasta y la cuenta regresiva se lee de
              lejos.

              La ranura ocupa SIEMPRE el mismo alto, aunque este vacia. Si
              apareciera y desapareciera, cada marcaje correria el boton de
              marcar hacia arriba y hacia abajo — y el juez ya aprendio donde
              apoyar el pulgar. Un boton que se mueve solo es un marcaje errado.
            */}
            {running && (
              <div className="mt-3 h-[5.5rem] shrink-0">
                {undoTarget && (
                  <button
                    type="button"
                    onClick={() => void undoLast()}
                    className="flex h-full w-full items-center justify-between rounded-2xl border-2 border-amber-400 bg-amber-400/15 px-5 text-left transition-transform active:scale-[0.99] active:bg-amber-400/25"
                  >
                    <span className="flex items-center gap-3">
                      <span className="text-3xl leading-none text-amber-300">↺</span>
                      <span>
                        <span className="block text-xl font-black tracking-wide text-amber-200">
                          DESHACER
                        </span>
                        <span className="block text-xs text-amber-300/70">último marcaje</span>
                      </span>
                    </span>
                    <Countdown
                      expiresAt={undoTarget.expiresAt}
                      className="font-mono text-3xl font-bold text-amber-300 tabular-nums"
                    />
                  </button>
                )}
              </div>
            )}

            <SplitList result={result} />

            <FooterActions
              canFinishEarly={running}
              allowReset={allowReset && !finalStatus}
              onDnf={() => void finishWith("dnf")}
              onReset={() => void reset()}
            />
          </section>
        </>
      )}

      {sheetOpen && (
        <PenaltySheet
          penalties={penalties}
          onPick={(p) => {
            void applyPenalty(p);
            navigator.vibrate?.([30, 40, 30]);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {confirmFastSplit && (
        <ConfirmDialog
          title="Marcaje muy rapido"
          body={`Pasaron menos de ${SUSPICIOUS_SPLIT_MS / 1000} segundos desde el marcaje anterior. ¿Es correcto?`}
          confirmLabel="Si, marcar"
          onConfirm={() => {
            void markSplit();
            setConfirmFastSplit(false);
          }}
          onCancel={() => setConfirmFastSplit(false)}
        />
      )}
    </main>
  );
}

/**
 * El heat todavia no largo.
 *
 * La largada la estampa el servidor para que los seis carriles del heat
 * compartan exactamente el mismo cero. Solo si no hay señal se ofrece largar
 * desde el dispositivo, y queda marcado para que la organizacion lo revise.
 */
function EsperandoLargada({
  online,
  localStart,
  onCheck,
  onLocalStart,
}: {
  online: boolean;
  localStart: "offline" | "siempre" | "nunca";
  onCheck: (() => Promise<void>) | null;
  onLocalStart: () => void;
}) {
  const [buscando, setBuscando] = useState(false);

  // Mientras haya señal, se pregunta sola: el juez no deberia tener que estar
  // apretando un boton justo cuando suena la bocina. El cuerpo del efecto solo
  // agenda, el trabajo pasa dentro del callback.
  useEffect(() => {
    if (!online || !onCheck) return;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelado) return;
      await onCheck();
      if (!cancelado) timer = setTimeout(poll, 3_000);
    };

    timer = setTimeout(poll, 0);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [online, onCheck]);

  return (
    <section className="safe-bottom flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center sm:px-8">
      <div>
        <p className="font-mono text-5xl font-bold text-neutral-700 tabular-nums">00:00.00</p>
        <p className="mt-4 text-xl font-semibold">Esperando la salida</p>
        <p className="mt-2 text-sm text-neutral-500">
          {!onCheck
            ? "Modo laboratorio: inicia tú el reloj."
            : online
              ? "El reloj arranca solo cuando la organización inicia el heat."
              : "Sin señal. Cuando vuelva la conexión, el reloj se ajusta a la salida oficial."}
        </p>
      </div>

      {online && onCheck && (
        <button
          type="button"
          onClick={async () => {
            setBuscando(true);
            await onCheck();
            setBuscando(false);
          }}
          className="rounded-xl border border-neutral-700 px-5 py-3 text-sm"
        >
          {buscando ? "Consultando…" : "Verificar ahora"}
        </button>
      )}

      {(localStart === "siempre" || (localStart === "offline" && !online)) && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm text-amber-200">
            {onCheck
              ? "Si el heat ya inició y no hay señal, puedes arrancar el reloj aquí. Queda marcado como salida provisional y se corrige sola al sincronizar."
              : "Inicia el reloj para probar el cronómetro."}
          </p>
          <button
            type="button"
            onClick={onLocalStart}
            className="mt-3 w-full rounded-xl bg-amber-400 py-3 font-bold text-amber-950"
          >
            {onCheck ? "INICIAR SIN SEÑAL" : "INICIAR CARRIL"}
          </button>
        </div>
      )}
    </section>
  );
}

function StatusBar({
  online,
  pendingCount,
  persisted,
}: {
  online: boolean;
  pendingCount: number;
  persisted: boolean;
}) {
  const synced = pendingCount === 0;
  const tone = online && synced ? "text-emerald-400" : "text-amber-400";

  return (
    <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-5 py-2 text-sm">
      <span className={`flex items-center gap-2 font-medium ${tone}`}>
        <span className="text-lg leading-none">●</span>
        {online ? "En linea" : "Sin conexión"}
      </span>
      <span className={synced ? "text-neutral-500" : "font-semibold text-amber-400"}>
        {synced ? "Todo sincronizado" : `${pendingCount} sin sincronizar`}
      </span>
      {!persisted && (
        <span
          className="text-xs text-neutral-600"
          title="El navegador podría liberar el almacenamiento local"
        >
          almacenamiento no fijado
        </span>
      )}
    </div>
  );
}

/**
 * El boton de marcar.
 *
 * Alto FIJO, nunca `flex-1`. Con flex-1 el boton cedia espacio cada vez que
 * aparecia la ranura de deshacer o crecia la lista de parciales: se achicaba en
 * cada marcaje y volvia a crecer diez segundos despues. El juez lo toca sin
 * mirar, de memoria — un boton que cambia de tamaño y de posicion en cada tap
 * es una fuente de marcajes errados.
 *
 * El clamp lo mantiene proporcional entre un celular chico y una tablet sin
 * depender de cuanto contenido haya debajo.
 */
function BigButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[clamp(13rem,40dvh,20rem)] shrink-0 flex-col items-center justify-center rounded-3xl bg-lime-400 px-6 text-center text-lime-950 shadow-lg transition-transform active:scale-[0.99] active:bg-lime-300"
    >
      {children}
    </button>
  );
}

/**
 * Segundos que quedan de la ventana de deshacer.
 *
 * Mismo criterio que LiveClock: un valor que cambia diez veces por segundo no
 * tiene por que re-renderizar la pantalla del juez. Se escribe al nodo directo.
 */
function Countdown({ expiresAt, className }: { expiresAt: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const paint = () => {
      const left = Math.max(0, expiresAt - Date.now());
      node.textContent = `${Math.ceil(left / 1000)}s`;
    };

    paint();
    const timer = setInterval(paint, 100);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return <span ref={ref} className={className} />;
}

function FinishCard({
  status,
  totalMs,
}: {
  status: "finished" | "dnf" | "dq";
  totalMs: number | null;
}) {
  const copy = {
    finished: {
      title: "CARRERA TERMINADA",
      tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    },
    dnf: {
      title: "NO TERMINO (DNF)",
      tone: "border-neutral-600 bg-neutral-800/60 text-neutral-300",
    },
    dq: { title: "DESCALIFICADO (DQ)", tone: "border-red-500/40 bg-red-500/10 text-red-300" },
  }[status];

  return (
    <div
      className={`flex h-[clamp(13rem,40dvh,20rem)] shrink-0 flex-col items-center justify-center rounded-3xl border ${copy.tone}`}
    >
      <p className="text-xl font-bold tracking-wide">{copy.title}</p>
      {totalMs !== null && (
        <p className="mt-2 font-mono text-4xl font-black tabular-nums">{formatElapsed(totalMs)}</p>
      )}
      <p className="mt-4 px-8 text-center text-sm text-neutral-500">
        El tiempo queda guardado en este dispositivo hasta que se sincronice.
      </p>
    </div>
  );
}

function SplitList({ result }: { result: ReturnType<typeof useRaceStore.getState>["result"] }) {
  if (!result || result.splits.length === 0) return null;

  return (
    <div className="mt-5">
      <h2 className="mb-2 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
        Parciales
      </h2>
      <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
        {[...result.splits].reverse().map((split) => (
          <li key={split.eventId} className="flex items-baseline justify-between px-4 py-3">
            <span className="text-sm text-neutral-300">
              <span className="mr-2 font-mono text-neutral-600">
                {String(split.orderIndex + 1).padStart(2, "0")}
              </span>
              {split.segmentName}
            </span>
            <span className="text-right">
              <span className="block font-mono text-base tabular-nums">
                {formatElapsed(split.durationMs)}
              </span>
              <span className="block font-mono text-xs text-neutral-500 tabular-nums">
                {formatElapsed(split.cumulativeMs)}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {result.anomalies.length > 0 && (
        <ul className="mt-3 space-y-1">
          {result.anomalies.map((a, i) => (
            <li key={`${a.code}-${i}`} className="text-xs text-amber-500/80">
              ⚠ {a.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FooterActions({
  canFinishEarly,
  allowReset,
  onDnf,
  onReset,
}: {
  canFinishEarly: boolean;
  allowReset: boolean;
  onDnf: () => void;
  onReset: () => void;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <div className="mt-6 flex items-center justify-between border-t border-neutral-800 pt-4 text-sm">
      {canFinishEarly ? (
        armed ? (
          <span className="flex gap-3">
            <button type="button" onClick={onDnf} className="font-semibold text-red-400">
              Confirmar DNF
            </button>
            <button type="button" onClick={() => setArmed(false)} className="text-neutral-500">
              Cancelar
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setArmed(true)} className="text-neutral-500">
            Marcar DNF
          </button>
        )
      ) : (
        <span />
      )}

      {allowReset && (
        <button type="button" onClick={onReset} className="text-neutral-500 hover:text-neutral-300">
          Reiniciar carril
        </button>
      )}
    </div>
  );
}

function PenaltySheet({
  penalties,
  onPick,
  onClose,
}: {
  penalties: PenaltyPayload[];
  onPick: (p: PenaltyPayload) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70" onClick={onClose}>
      <div
        className="rounded-t-3xl border-t border-neutral-700 bg-neutral-900 p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold">Aplicar penalizacion</h2>
        {penalties.length === 0 ? (
          <p className="text-sm text-neutral-500">Este evento no tiene penalizaciones cargadas.</p>
        ) : (
          <ul className="space-y-2">
            {penalties.map((p) => (
              <li key={p.code}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="flex w-full items-center justify-between rounded-2xl border border-neutral-700 px-4 py-4 text-left active:bg-neutral-800"
                >
                  <span className="font-semibold">{p.label}</span>
                  <span className="font-mono text-sm text-amber-400">
                    {p.kind === "time_add" ? `+${p.seconds}s` : p.kind === "dq" ? "DQ" : "no rep"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-2xl py-4 text-center text-neutral-400"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-sm rounded-3xl border border-neutral-700 bg-neutral-900 p-6">
        <h2 className="text-lg font-bold text-amber-400">{title}</h2>
        <p className="mt-2 text-sm text-neutral-300">{body}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-neutral-700 py-4 font-semibold"
          >
            No
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-2xl bg-lime-400 py-4 font-bold text-lime-950"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Recordatorio de que UNDO_WINDOW_MS es el contrato con el juez, no un detalle. */
export const UNDO_WINDOW_SECONDS = UNDO_WINDOW_MS / 1000;
