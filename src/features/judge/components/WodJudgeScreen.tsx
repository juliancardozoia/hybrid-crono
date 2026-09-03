"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import { planDelWod, reduceWodEvents, type WodStep, type WodStructure } from "@/shared/timing/wod";
import { startHeartbeat, useRaceStore } from "../lib/store";
import { startSyncLoop, supabaseTransport, type SyncOutcome, type Transport } from "../lib/sync";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { useWakeLock } from "../lib/useWakeLock";
import { LiveClock } from "./LiveClock";
import { CuentaRegresiva } from "./CuentaRegresiva";

/**
 * La pantalla del juez de CrossFit.
 *
 * Es una pantalla nueva y no una rama de la de Hyrox: contar repeticiones,
 * saltar movimientos y registrar intentos de levantamiento no se parece en nada
 * a marcar parciales de un circuito, y meter las dos en un componente lo
 * volveria ilegible justo donde no se puede fallar.
 *
 * Lo que SI comparte es todo lo que ya se pago en competencia: el mismo store
 * —o sea IndexedDB antes que la red, el mismo ancla y el mismo outbox—, el alto
 * fijo del boton dominante, la ranura de deshacer siempre reservada, el wake
 * lock, el alto contraste y el banner de red que nunca bloquea.
 *
 * Todo lo que muestra sale de la estructura de la prueba. El juez no configura
 * nada: abre el carril y marca.
 */

export interface ParteJuzgable {
  partId: string;
  label: string;
  structure: WodStructure;
}

export interface WodJudgeScreenProps {
  laneId: string;
  bib: string;
  athlete: string;
  subtitle?: string;
  partes: ParteJuzgable[];
  heatStartEpochMs: number | null;
  startOffsetMs?: number;
  recordedBy?: string;
  transport?: Transport;
  onCheckStart?: () => Promise<number | null>;
  localStart?: "offline" | "siempre" | "nunca";
}

/** Un movimiento que no se cuenta de a uno: se escribe el numero y listo. */
function seEscribe(unit: string): boolean {
  return unit === "metros" || unit === "calorias" || unit === "segundos";
}

const UNIDAD_CORTA: Record<string, string> = {
  reps: "reps",
  metros: "m",
  calorias: "cal",
  segundos: "s",
  kg: "kg",
};

export function WodJudgeScreen({
  laneId,
  bib,
  athlete,
  subtitle,
  partes,
  heatStartEpochMs,
  startOffsetMs = 0,
  recordedBy = "",
  transport = supabaseTransport,
  onCheckStart,
  localStart = "nunca",
}: WodJudgeScreenProps) {
  const {
    anchor,
    events,
    pendingCount,
    storagePersisted,
    hydrated,
    undoTarget,
    anchorDriftMs,
    init,
    applyServerStart,
    startLocally,
    markWod,
    undoLast,
    refreshPending,
    currentElapsed,
  } = useRaceStore();

  const online = useOnlineStatus();
  const [indiceParte, setIndiceParte] = useState(0);
  const [syncError, setSyncError] = useState<{ texto: string; fatal: boolean } | null>(null);
  const [cantidad, setCantidad] = useState("");
  const [kilos, setKilos] = useState("");
  const [confirmandoDnf, setConfirmandoDnf] = useState(false);
  // Se recalcula una vez por segundo, no por frame: alcanza para detectar el
  // cap y no cuesta bateria. Guarda el reloj de pared ademas del contador
  // porque la cuenta atras de DESHACER lo necesita, y leer `Date.now()` durante
  // el render da un valor que cambia solo cuando el arbol se re-renderiza por
  // otra cosa — o sea, un numero que se congela sin motivo visible.
  const [tick, setTick] = useState(0);
  const [ahoraMs, setAhoraMs] = useState(0);

  const parte = partes[Math.min(indiceParte, partes.length - 1)];

  useEffect(() => {
    // El WOD no tiene segmentos: el reductor de circuitos queda inerte y el
    // store solo aporta el ancla, el log y el outbox.
    void init({ laneId, segments: [], heatStartEpochMs, startOffsetMs, recordedBy });
  }, [init, laneId, heatStartEpochMs, startOffsetMs, recordedBy]);

  const onSync = useCallback(
    (outcome: SyncOutcome) => {
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

  useEffect(() => {
    if (!anchor) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      setAhoraMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [anchor]);

  /**
   * Los marcajes de cada parte se separan por `payload.partId`.
   *
   * La largada vale para las dos: es una sola, del heat.
   */
  const eventosDeLaParte = useMemo(
    () =>
      events.filter((e) => e.type === "lane_start" || e.payload?.partId === parte?.partId),
    [events, parte?.partId],
  );

  const resultado = useMemo(
    () =>
      parte
        ? reduceWodEvents(
            laneId,
            eventosDeLaParte,
            parte.structure,
            anchor ? currentElapsed() : undefined,
          )
        : null,
    // `tick` entra a proposito: es lo que hace que el cap se detecte aunque el
    // juez no toque nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parte, laneId, eventosDeLaParte, anchor, tick],
  );

  const plan = useMemo(() => (parte ? planDelWod(parte.structure) : []), [parte]);
  const paso: WodStep | null =
    resultado?.currentStepIndex != null ? (plan[resultado.currentStepIndex] ?? null) : null;

  const corriendo = resultado?.status === "running";
  useWakeLock(corriendo);

  const marcar = useCallback(
    (type: Parameters<typeof markWod>[0]["type"], payload: Record<string, unknown> = {}) => {
      if (!parte) return;
      void markWod({ type, payload: { partId: parte.partId, ...payload } });
      navigator.vibrate?.(40);
    },
    [markWod, parte],
  );

  const checkStart = useCallback(async () => {
    const epoch = await onCheckStart?.();
    if (epoch !== null && epoch !== undefined) await applyServerStart(epoch);
  }, [onCheckStart, applyServerStart]);

  if (!hydrated || !parte || !resultado) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-neutral-500">
        <p className="text-lg">Cargando carril…</p>
      </main>
    );
  }

  const esquema = parte.structure.scheme;
  const terminado =
    resultado.status === "finished" || resultado.status === "dnf" || resultado.status === "dq";

  return (
    <main className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <BarraDeEstado
        online={online}
        pendientes={pendingCount}
        almacenamiento={storagePersisted}
      />

      <header className="px-4 pt-2">
        <div className="flex items-baseline gap-3">
          <span className="rounded-lg bg-white px-2.5 py-1 font-mono text-lg font-bold text-neutral-950">
            {bib}
          </span>
          <h1 className="min-w-0 flex-1 truncate text-2xl font-bold">{athlete}</h1>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {[subtitle, partes.length > 1 ? `Parte ${parte.label || indiceParte + 1}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {syncError && (
        <p
          className={`mx-4 mt-3 rounded-xl border p-3 text-sm ${
            syncError.fatal
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-200"
          }`}
        >
          {syncError.texto}
        </p>
      )}

      {anchorDriftMs !== null && anchorDriftMs !== 0 && (
        <p className="mx-4 mt-3 rounded-xl border border-neutral-700 bg-neutral-900 p-3 text-sm text-neutral-300">
          El reloj se ajustó {formatElapsed(Math.abs(anchorDriftMs))} al llegar la salida oficial.
        </p>
      )}

      {!anchor ? (
        <EsperandoLargada
          online={online}
          localStart={localStart}
          onCheck={checkStart}
          onStartLocal={() => void startLocally()}
        />
      ) : (
        <>
          <section className="px-4 pt-4 text-center">
            {esquema === "ventana" && parte.structure.windowMs ? (
              <CuentaRegresiva
                anchor={anchor}
                duracionMs={parte.structure.windowMs}
                className="font-mono text-5xl font-bold tabular-nums"
              />
            ) : esquema === "sin_reloj" ? (
              <p className="font-mono text-3xl font-bold text-neutral-500">Sin reloj</p>
            ) : (
              <LiveClock
                anchor={anchor}
                frozenMs={resultado.stoppedAtMs}
                className="font-mono text-5xl font-bold tabular-nums"
              />
            )}

            <p className="mt-1 text-sm text-neutral-500">
              {esquema === "ventana" ? "restante" : "transcurrido"}
              {resultado.capped && <span className="ml-2 text-amber-300">· CAPEADO</span>}
            </p>
          </section>

          {esquema === "sin_reloj" ? (
            <Intentos
              kilos={kilos}
              setKilos={setKilos}
              intentos={resultado.attempts}
              mejor={resultado.bestLiftKg}
              onRegistrar={(valido) => {
                const loadKg = Number(kilos);
                if (!Number.isFinite(loadKg) || loadKg <= 0) return;
                marcar("lift", { loadKg, valido, intento: resultado.attempts.length + 1 });
                setKilos("");
              }}
            />
          ) : terminado || !paso ? (
            <Cerrado resultado={resultado} esquema={esquema} />
          ) : (
            <Marcador
              paso={paso}
              progreso={resultado.currentStepProgress}
              cantidad={cantidad}
              setCantidad={setCantidad}
              onRep={() => marcar("rep", { partMovementId: paso.movementId, round: paso.round })}
              onNoRep={() =>
                marcar("no_rep", { partMovementId: paso.movementId, round: paso.round })
              }
              onCerrarMovimiento={(valor) =>
                marcar("movement_done", {
                  partMovementId: paso.movementId,
                  round: paso.round,
                  ...(valor !== undefined ? { cantidad: valor } : {}),
                })
              }
            />
          )}

          {/* La ranura de deshacer reserva su alto SIEMPRE, aunque este vacia:
              un boton que se mueve entre taps es una fuente de marcajes
              errados. */}
          <div className="h-[5.5rem] px-4">
            {undoTarget && (
              <button
                type="button"
                onClick={() => void undoLast()}
                className="h-full w-full rounded-2xl border border-neutral-700 text-lg font-semibold text-neutral-300"
              >
                DESHACER
                <span className="ml-2 font-mono text-sm text-neutral-500">
                  {Math.max(0, Math.ceil((undoTarget.expiresAt - ahoraMs) / 1000))}s
                </span>
              </button>
            )}
          </div>

          <Progreso resultado={resultado} esquema={esquema} plan={plan} />

          <footer className="safe-bottom mt-auto flex gap-2 px-4 pt-4 pb-2">
            {!terminado && (
              <button
                type="button"
                onClick={() => {
                  if (!confirmandoDnf) {
                    setConfirmandoDnf(true);
                    return;
                  }
                  marcar("dnf");
                  setConfirmandoDnf(false);
                }}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm ${
                  confirmandoDnf
                    ? "border-red-500 bg-red-500/10 text-red-300"
                    : "border-neutral-800 text-neutral-500"
                }`}
              >
                {confirmandoDnf ? "Confirmar DNF" : "Marcar DNF"}
              </button>
            )}

            {terminado && indiceParte < partes.length - 1 && (
              <button
                type="button"
                onClick={() => {
                  setIndiceParte(indiceParte + 1);
                  setConfirmandoDnf(false);
                }}
                className="flex-1 rounded-xl bg-lime-400 px-4 py-3 font-bold text-lime-950"
              >
                Empezar parte {partes[indiceParte + 1].label || indiceParte + 2} ▸
              </button>
            )}
          </footer>
        </>
      )}
    </main>
  );
}

function BarraDeEstado({
  online,
  pendientes,
  almacenamiento,
}: {
  online: boolean;
  pendientes: number;
  almacenamiento: boolean;
}) {
  return (
    <div className="safe-top flex items-center gap-3 px-4 py-2 text-xs">
      <span className={online ? "text-lime-400" : "text-amber-400"}>
        ● {online ? "En línea" : "Offline"}
      </span>
      {pendientes > 0 && <span className="text-neutral-400">{pendientes} sin sincronizar</span>}
      {!almacenamiento && (
        <span className="ml-auto text-neutral-600">almacenamiento no fijado</span>
      )}
    </div>
  );
}

function EsperandoLargada({
  online,
  localStart,
  onCheck,
  onStartLocal,
}: {
  online: boolean;
  localStart: "offline" | "siempre" | "nunca";
  onCheck: () => Promise<void>;
  onStartLocal: () => void;
}) {
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => void onCheck(), 3000);
    return () => clearInterval(timer);
  }, [online, onCheck]);

  const ofrecerLocal = localStart === "siempre" || (localStart === "offline" && !online);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
      <p className="text-xl font-semibold">Esperando la largada</p>
      <p className="text-sm text-neutral-500">
        {online
          ? "La organización todavía no largó este heat."
          : "Sin señal. Cuando vuelva, la largada oficial llega sola."}
      </p>
      {ofrecerLocal && (
        <button
          type="button"
          onClick={onStartLocal}
          className="rounded-2xl border border-amber-500/50 px-6 py-4 text-lg font-bold text-amber-200"
        >
          INICIAR SIN SEÑAL
        </button>
      )}
    </section>
  );
}

function Marcador({
  paso,
  progreso,
  cantidad,
  setCantidad,
  onRep,
  onNoRep,
  onCerrarMovimiento,
}: {
  paso: WodStep;
  progreso: number;
  cantidad: string;
  setCantidad: (v: string) => void;
  onRep: () => void;
  onNoRep: () => void;
  onCerrarMovimiento: (valor?: number) => void;
}) {
  const escribible = seEscribe(paso.unit);

  return (
    <section className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-baseline justify-between">
        <p className="text-xl font-bold uppercase">{paso.name}</p>
        <p className="text-lg text-neutral-400">
          {paso.loadKg !== null && `${paso.loadKg} kg`}
        </p>
      </div>

      {escribible ? (
        <div className="flex flex-col gap-3">
          <p className="text-center text-neutral-400">
            {paso.maxReps ? "Hasta que suene" : `${paso.target} ${UNIDAD_CORTA[paso.unit]}`}
          </p>
          <input
            inputMode="numeric"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={String(paso.target || 0)}
            className="rounded-2xl border border-neutral-700 bg-transparent px-4 py-6 text-center font-mono text-4xl outline-none focus:border-lime-400"
          />
          <button
            type="button"
            onClick={() => {
              const valor = Number(cantidad);
              onCerrarMovimiento(Number.isFinite(valor) && cantidad !== "" ? valor : undefined);
              setCantidad("");
            }}
            /* Nadie tapea quinientos metros: se escribe el numero. */
            className="rounded-2xl bg-lime-400 py-6 text-2xl font-bold text-lime-950"
          >
            REGISTRAR
          </button>
        </div>
      ) : (
        <>
          {/* Alto FIJO, nunca flex-1: un boton que cambia de tamano y de
              posicion en cada tap es una fuente de marcajes errados. */}
          <button
            type="button"
            onClick={onRep}
            className="flex h-[clamp(13rem,40dvh,20rem)] w-full flex-col items-center justify-center gap-2 rounded-3xl bg-lime-400 text-lime-950 active:bg-lime-300"
          >
            <span className="font-mono text-6xl font-black tabular-nums">
              {progreso}
              {!paso.maxReps && paso.target > 0 && (
                <span className="text-4xl opacity-60"> / {paso.target}</span>
              )}
            </span>
            <span className="text-2xl font-bold">+ REP</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onNoRep}
              className="rounded-2xl border border-red-500/50 py-4 text-lg font-bold text-red-300"
            >
              NO REP
            </button>
            <button
              type="button"
              onClick={() => onCerrarMovimiento()}
              className="rounded-2xl border border-neutral-700 py-4 text-lg font-semibold text-neutral-300"
            >
              MOVIMIENTO ✓
            </button>
          </div>
        </>
      )}

      <p className="text-center text-sm text-neutral-500">
        Ronda {paso.round}
        {paso.isTiebreak && " · marca el desempate"}
      </p>
    </section>
  );
}

function Intentos({
  kilos,
  setKilos,
  intentos,
  mejor,
  onRegistrar,
}: {
  kilos: string;
  setKilos: (v: string) => void;
  intentos: Array<{ loadKg: number; valido: boolean }>;
  mejor: number | null;
  onRegistrar: (valido: boolean) => void;
}) {
  return (
    <section className="flex flex-col gap-3 px-4 pt-4">
      <p className="text-center text-neutral-400">Intento {intentos.length + 1}</p>
      <input
        inputMode="decimal"
        value={kilos}
        onChange={(e) => setKilos(e.target.value.replace(/[^0-9.]/g, ""))}
        placeholder="kg"
        className="rounded-2xl border border-neutral-700 bg-transparent px-4 py-6 text-center font-mono text-5xl outline-none focus:border-lime-400"
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onRegistrar(true)}
          className="rounded-2xl bg-lime-400 py-6 text-2xl font-bold text-lime-950"
        >
          VÁLIDO
        </button>
        <button
          type="button"
          onClick={() => onRegistrar(false)}
          className="rounded-2xl border border-red-500/50 py-6 text-2xl font-bold text-red-300"
        >
          NULO
        </button>
      </div>

      {intentos.length > 0 && (
        <p className="text-center text-sm text-neutral-400">
          {intentos.map((a, i) => (
            <span key={i} className={a.valido ? "text-lime-400" : "text-red-400"}>
              {a.valido ? "✓" : "✗"} {a.loadKg}
              {i < intentos.length - 1 && <span className="text-neutral-700"> · </span>}
            </span>
          ))}
        </p>
      )}
      {mejor !== null && (
        <p className="text-center text-lg font-bold">Mejor: {mejor} kg</p>
      )}
    </section>
  );
}

function Cerrado({
  resultado,
  esquema,
}: {
  resultado: NonNullable<ReturnType<typeof reduceWodEvents>>;
  esquema: string;
}) {
  const titulo =
    resultado.status === "dq"
      ? "DESCALIFICADO"
      : resultado.status === "dnf"
        ? "NO TERMINÓ"
        : resultado.capped
          ? "CAPEADO"
          : "TERMINÓ";

  return (
    <section className="flex h-[clamp(13rem,40dvh,20rem)] flex-col items-center justify-center gap-2 px-4">
      <p className="text-3xl font-black">{titulo}</p>
      {esquema === "ventana" ? (
        <p className="font-mono text-2xl">
          {resultado.completedRounds} rondas + {resultado.repsInRound}
        </p>
      ) : resultado.finishedMs !== null ? (
        <p className="font-mono text-2xl">{formatElapsed(resultado.finishedMs)}</p>
      ) : (
        <p className="font-mono text-2xl">{resultado.completedReps} reps</p>
      )}
    </section>
  );
}

function Progreso({
  resultado,
  esquema,
  plan,
}: {
  resultado: NonNullable<ReturnType<typeof reduceWodEvents>>;
  esquema: string;
  plan: WodStep[];
}) {
  return (
    <section className="flex flex-wrap justify-center gap-x-5 gap-y-1 px-4 text-sm text-neutral-400">
      {esquema === "ventana" ? (
        <span>
          Ronda {resultado.completedRounds + 1} · {resultado.completedReps} reps
        </span>
      ) : (
        <span>
          {resultado.currentStepIndex != null
            ? `Paso ${resultado.currentStepIndex + 1} de ${plan.length}`
            : `${plan.length} de ${plan.length}`}
        </span>
      )}
      {resultado.noRepCount > 0 && (
        <span className="text-red-400">{resultado.noRepCount} no reps</span>
      )}
      {resultado.tiebreakMs !== null && (
        <span>desempate {formatElapsed(resultado.tiebreakMs)}</span>
      )}
    </section>
  );
}
