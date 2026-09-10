"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import {
  planDelWod,
  reduceWodEvents,
  type CaptureStyle,
  type WodStep,
  type WodStructure,
} from "@/shared/timing/wod";
import { formatearCarga } from "@/shared/unidades/carga";
import { startHeartbeat, useRaceStore } from "../lib/store";
import { startSyncLoop, supabaseTransport, type SyncOutcome, type Transport } from "../lib/sync";
import { useDetectarLargadaDeshecha } from "../lib/useDetectarLargadaDeshecha";
import { useSincronizarEventosRemotos } from "../lib/useSincronizarEventosRemotos";
import { useOnlineStatus } from "../lib/useOnlineStatus";
import { useWakeLock } from "../lib/useWakeLock";
import { LiveClock } from "./LiveClock";
import { CuentaRegresiva } from "./CuentaRegresiva";
import { Boton } from "@/shared/components/Boton";
import { AvisoDeDrift, BarraDeEstadoJuez, RanuraDeDeshacer } from "./EstadoDeJuez";

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
  /**
   * El nombre de la prueba. Opcional: un bundle cacheado antes de esta version
   * no lo trae, y ahi la pantalla simplemente no lo menciona.
   */
  workoutName?: string;
  partes: ParteJuzgable[];
  heatStartEpochMs: number | null;
  startOffsetMs?: number;
  recordedBy?: string;
  transport?: Transport;
  onCheckStart?: () => Promise<number | null>;
  localStart?: "offline" | "siempre" | "nunca";
}

/**
 * Las causas de un no-rep, ofrecidas DESPUES del tap.
 *
 * Son las cuatro que cubren casi todo y caben en una fila. La quinta se
 * escribiria a mano, y escribir con el atleta trabajando no es una opcion.
 */
const MOTIVOS = ["profundidad", "lockout", "contacto", "línea"];

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
  workoutName,
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
  const [largadaDeshecha, setLargadaDeshecha] = useState(false);

  // Ver useDetectarLargadaDeshecha: si la organización deshace una largada
  // falsa despues de que este carril ya anclo su reloj, sin esto seguiria
  // corriendo sobre un heat que ya no existe.
  useDetectarLargadaDeshecha(onCheckStart, online, () => setLargadaDeshecha(true));
  // Un DNF marcado desde la torre de control -u otro evento insertado por
  // la organización- no le llega solo: el sync normal es de solo subida.
  useSincronizarEventosRemotos(laneId, online);
  const [cantidad, setCantidad] = useState("");
  const [kilos, setKilos] = useState("");
  const [confirmandoDnf, setConfirmandoDnf] = useState(false);
  // Se recalcula una vez por segundo, no por frame: alcanza para detectar el
  // cap y no cuesta bateria.
  const [tick, setTick] = useState(0);

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
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
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

  // Se acabó el tiempo se SIENTE, no solo se ve: el juez está mirando al
  // atleta, no la pantalla, igual que el no-rep. Dispara UNA sola vez en la
  // transición false -> true, con el mismo `resultado.capped` que decide si
  // la pantalla pasa a "CAPEADO" — así el aviso y el cambio de pantalla
  // llegan siempre juntos, nunca uno antes que el otro.
  const capeadoAntesRef = useRef(false);
  useEffect(() => {
    const capeadoAhora = resultado?.capped ?? false;
    if (capeadoAhora && !capeadoAntesRef.current) {
      navigator.vibrate?.([80, 60, 80, 60, 220]);
    }
    capeadoAntesRef.current = capeadoAhora;
  }, [resultado?.capped]);

  // El recalculo del servidor (el que cierra `heats.ended_at`, ver
  // recompute.ts) solo se dispara cuando llega un LOTE nuevo al sincronizar —
  // y un AMRAP que agota su ventana, o un For Time que llega al cap, no
  // generan ningun evento nuevo si el juez no vuelve a tocar nada: el
  // reductor lo detecta solo, comparando contra el reloj. Sin este empujon la
  // tarjeta de la torre de control se queda con el reloj corriendo para
  // siempre, aunque el WOD ya haya terminado en la pantalla del juez. Dispara
  // UNA vez, en la misma transicion que ya usa la vibracion del cap — cubre
  // ademas el cierre normal (`finished`) y DNF/DQ, no solo el cap.
  const terminalAntesRef = useRef(false);
  useEffect(() => {
    const terminalAhora =
      resultado?.status === "finished" ||
      resultado?.status === "dnf" ||
      resultado?.status === "dq" ||
      (resultado?.capped ?? false);
    if (terminalAhora && !terminalAntesRef.current) {
      void fetch("/api/resultados/recalcular", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ laneId }),
      }).catch(() => {});
    }
    terminalAntesRef.current = terminalAhora;
  }, [resultado?.status, resultado?.capped, laneId]);

  const marcar = useCallback(
    (type: Parameters<typeof markWod>[0]["type"], payload: Record<string, unknown> = {}) => {
      if (!parte) return;
      void markWod({ type, payload: { partId: parte.partId, ...payload } });
      // Un no-rep se SIENTE distinto. La confirmacion durante la accion no
      // puede depender de que el juez mire la pantalla: esta mirando al
      // atleta, y una rep valida y un no-rep vibraban igual.
      navigator.vibrate?.(type === "no_rep" ? [30, 50, 30] : 40);
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
  // `resultado.capped` NUNCA pone `status` en "finished" -queda en "running"
  // para siempre, es lo que despues traduce `scoreFromWodResult` a
  // "capeado"- asi que sin sumarlo aca la pantalla seguiria mostrando el
  // Marcador interactivo despues del cap, aceptando toques que el reductor ya
  // ignora en silencio.
  const terminado =
    resultado.status === "finished" ||
    resultado.status === "dnf" ||
    resultado.status === "dq" ||
    resultado.capped;

  return (
    <main className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <div className="safe-top">
        <BarraDeEstadoJuez online={online} pendientes={pendingCount} persistido={storagePersisted} />
      </div>

      <header className="px-4 pt-2">
        <div className="flex items-baseline gap-3">
          <span className="rounded-lg bg-white px-2.5 py-1 font-mono text-lg font-bold text-neutral-950">
            {bib}
          </span>
          <h1 className="min-w-0 flex-1 truncate text-2xl font-bold">{athlete}</h1>
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {[
            workoutName,
            subtitle,
            partes.length > 1 ? `Parte ${parte.label || indiceParte + 1}` : null,
          ]
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

      {largadaDeshecha && !anchor && (
        <p className="mx-4 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          La organización deshizo la largada de este heat — probablemente una salida en falso.
          Esperando la salida de nuevo.
        </p>
      )}

      <AvisoDeDrift anchorDriftMs={anchorDriftMs} />

      {!anchor ? (
        <EsperandoLargada
          online={online}
          localStart={localStart}
          onCheck={checkStart}
          onStartLocal={() => void startLocally()}
        />
      ) : (
        <>
          {/* `destello-de-largada`: ver globals.css. Mismo tratamiento que
              JudgeScreen — se dispara solo al montarse esta seccion. */}
          <section className="destello-de-largada rounded-2xl px-4 pt-4 text-center">
            {esquema === "ventana" && parte.structure.windowMs ? (
              <CuentaRegresiva
                anchor={anchor}
                duracionMs={parte.structure.windowMs}
                umbralAmbarMs={60_000}
                umbralRojoMs={10_000}
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

            {/* Cuánto falta para el cap, SIEMPRE a la vista mientras corre —
                es la pieza que faltaba: sin esto el reloj solo cuenta para
                arriba y el juez tiene que restar de memoria cuánto queda,
                que es justo lo que hace que alguien siga marcando después de
                la bocina sin darse cuenta. Se apaga al terminar, capee o no:
                un atleta que cerró ANTES del cap no necesita ver una cuenta
                regresiva siguiendo corriendo en pantalla — es lo que se
                reportó como confuso, tanto para el juez como para el atleta
                que la mira de reojo. */}
            {esquema === "cap" && parte.structure.timeCapMs !== null && !terminado && (
              <p className="mt-1 font-mono text-lg font-semibold text-neutral-500">
                <CuentaRegresiva
                  anchor={anchor}
                  duracionMs={parte.structure.timeCapMs}
                  umbralAmbarMs={60_000}
                  umbralRojoMs={10_000}
                />
                <span className="ml-1.5 font-sans text-sm font-normal text-neutral-600">
                  para el cap
                </span>
              </p>
            )}
          </section>

          {esquema === "sin_reloj" ? (
            <Intentos
              kilos={kilos}
              setKilos={setKilos}
              intentos={resultado.attempts}
              maxAttempts={resultado.maxAttempts}
              mejor={resultado.bestLiftKg}
              terminado={terminado}
              onRegistrar={(valido) => {
                const loadKg = Number(kilos);
                if (!Number.isFinite(loadKg) || loadKg <= 0) return;
                marcar("lift", { loadKg, valido, intento: resultado.attempts.length + 1 });
                setKilos("");
              }}
            />
          ) : resultado.awaitingFinalTally && paso ? (
            <CierreDelTiempo
              key={paso.index}
              paso={paso}
              progreso={resultado.currentStepProgress}
              onConfirmar={(valor) =>
                marcar("movement_done", {
                  partMovementId: paso.movementId,
                  round: paso.round,
                  cantidad: valor,
                })
              }
            />
          ) : terminado || !paso ? (
            <Cerrado resultado={resultado} esquema={esquema} plan={plan} />
          ) : (
            <Marcador
              /* Remonta al cambiar de paso: sin esto, "CONTAR A MANO" o el
                 teclado de confirmar se arrastrarian al movimiento siguiente. */
              key={paso.index}
              paso={paso}
              esAmrap={esquema === "ventana"}
              progreso={resultado.currentStepProgress}
              cantidad={cantidad}
              setCantidad={setCantidad}
              onRep={() => marcar("rep", { partMovementId: paso.movementId, round: paso.round })}
              onNoRep={() =>
                marcar("no_rep", { partMovementId: paso.movementId, round: paso.round })
              }
              /* La causa va como `note` y NO como un segundo `no_rep`: el
                 reductor ignora las notas, asi que clasificar no cambia ningun
                 numero — solo deja el motivo en el log, que es lo que hace
                 defendible un reclamo. */
              onMotivo={(motivo) =>
                marcar("note", {
                  partMovementId: paso.movementId,
                  round: paso.round,
                  sobre: "no_rep",
                  motivo,
                })
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

          <div className="px-4">
            <RanuraDeDeshacer
              undoTarget={undoTarget}
              onUndo={() => void undoLast()}
              subtitulo="última marca"
            />
          </div>

          <Progreso
            resultado={resultado}
            esquema={esquema}
            plan={plan}
            terminado={terminado}
            siguiente={
              resultado.currentStepIndex != null
                ? (plan[resultado.currentStepIndex + 1] ?? null)
                : null
            }
          />

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

/**
 * El heat todavia no largo.
 *
 * MISMO TRATAMIENTO QUE JudgeScreen: "ESPERANDO LARGADA" como estado
 * principal, sin ningun numero que pueda leerse como un reloj corriendo — acá
 * nunca hubo un "00:00.00" falso, pero el titulo vivia en texto normal
 * (`text-xl font-semibold`) sin distinguirse del resto de la pantalla. Las dos
 * pantallas de juez tienen que verse como el mismo estado, no como dos
 * comportamientos parecidos.
 *
 * "VERIFICAR AHORA" TAMBIEN SE AGREGA ACA. Esta pantalla ya pregunta sola cada
 * 3s mientras haya señal, pero a diferencia de JudgeScreen no le daba al juez
 * ningun control manual — si el poll tarda o el juez quiere confirmar antes de
 * que llegue, no tenia nada que tocar. Mismo boton, mismo comportamiento.
 */
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
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (!online) return;
    const timer = setInterval(() => void onCheck(), 3000);
    return () => clearInterval(timer);
  }, [online, onCheck]);

  const ofrecerLocal = localStart === "siempre" || (localStart === "offline" && !online);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
      <div>
        <div className="inline-flex items-center gap-2.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-5 py-2.5">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-400" />
          <span className="text-lg font-black tracking-wide text-amber-300 uppercase sm:text-xl">
            Esperando largada
          </span>
        </div>
        <p className="mt-4 text-sm text-neutral-500">
          {online
            ? "La organización todavía no largó este heat."
            : "Sin señal. Cuando vuelva, la largada oficial llega sola."}
        </p>
      </div>

      {online && (
        <Boton
          variante="secondary"
          cargando={buscando}
          textoCargando="Consultando…"
          onClick={async () => {
            setBuscando(true);
            await onCheck();
            setBuscando(false);
          }}
        >
          Verificar ahora
        </Boton>
      )}

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
  onMotivo,
  onCerrarMovimiento,
  esAmrap,
}: {
  paso: WodStep;
  progreso: number;
  cantidad: string;
  setCantidad: (v: string) => void;
  onRep: () => void;
  onNoRep: () => void;
  onMotivo: (motivo: string) => void;
  onCerrarMovimiento: (valor?: number) => void;
  /**
   * En un AMRAP, `paso.totalRounds` es un techo interno (ver `wod.ts`,
   * `repeticionesDelBloque` en el constructor), no la cantidad real de
   * rondas que va a hacer el atleta: mostrarlo ("Ronda 4 de 50") confundiria
   * al juez con un numero que no significa nada para el.
   */
  esAmrap: boolean;
}) {
  /**
   * "CONTAR A MANO" baja ESTE paso a tap, para ESTE atleta.
   *
   * Es lo que hace seguro tener un default. Cubre el caso real —el atleta
   * empieza a fallar repeticiones y el juez decide que sí necesita contar
   * ésta— y significa que un derivado equivocado está a un toque de estar
   * bien. No escribe NADA: cero eventos, cero red. Se reinicia solo al pasar
   * de paso, porque el componente se remonta con `key={paso.index}`.
   */
  const [contandoAMano, setContandoAMano] = useState(false);

  /**
   * Cerrar el movimiento pidiendo la cantidad real.
   *
   * Antes "MOVIMIENTO ✓" cerraba con `max(objetivo, progreso)` en silencio: si
   * el juez se atrasó contando, eso INVENTABA repeticiones que nadie hizo.
   * Ahora abre el teclado con lo que lleva contado: confirmar es un toque,
   * corregir es escribir.
   */
  const [confirmando, setConfirmando] = useState(false);

  /**
   * El motivo del no-rep: opcional y DIFERIDO.
   *
   * El tap va primero y el no-rep queda registrado en el acto. La causa se
   * ofrece después y se puede ignorar: obligar a elegir una razón mientras el
   * atleta sigue trabajando es exactamente lo que esta pantalla no puede
   * hacer.
   */
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);

  const estilo: CaptureStyle = contandoAMano ? "tap" : paso.captureStyle;
  const escribiendo = confirmando || estilo === "numero";

  // El objetivo del paso, como tope de lo que se puede escribir a mano. Un
  // `maxReps` no tiene objetivo que respetar -ahi contar ES el resultado- y
  // sin tope el juez podria tipear de mas y darle al atleta reps (y puntos)
  // que no hizo. El reductor tambien lo recorta (defensa en profundidad): acá
  // es para que el juez lo vea ANTES de mandarlo.
  const topeMax = !paso.maxReps && paso.target > 0 ? paso.target : null;

  const registrar = (valor: string) => {
    const n = Number(valor);
    const acotado = topeMax !== null && n > topeMax ? topeMax : n;
    onCerrarMovimiento(Number.isFinite(acotado) && valor !== "" ? acotado : undefined);
    setCantidad("");
    setConfirmando(false);
  };

  const noRep = () => {
    onNoRep();
    setPidiendoMotivo(true);
  };

  return (
    <section className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xl font-bold uppercase">{paso.name}</p>
        <p className="text-lg text-neutral-400">
          {/* En la unidad en que lo programó el organizador: el juez lee el
              mismo número que está en la pizarra y en la barra. */}
          {paso.loadKg !== null && formatearCarga(paso.loadKg, paso.loadUnit)}
        </p>
      </div>

      {/* En `tap` el contador ya dice "7 / 21". En los otros dos el objetivo
          no se ve en ningún lado, y "500 m" es justamente lo que el juez tiene
          que confirmar. */}
      {estilo !== "tap" && (
        <p className="text-center text-neutral-400">
          {paso.maxReps
            ? "Hasta que suene"
            : `${paso.target} ${UNIDAD_CORTA[paso.unit] ?? paso.unit}`}
        </p>
      )}

      {/* LA CAJA. Mismo alto y misma posición en los tres estilos: un botón
          que cambia de tamaño entre movimientos hace que el pulgar del juez
          caiga en otro lado, y el juez no está mirando la pantalla. */}
      <div className="flex h-[clamp(13rem,40dvh,20rem)] flex-col">
        {escribiendo ? (
          <div className="flex h-full flex-col gap-2">
            <input
              inputMode="numeric"
              autoFocus
              value={cantidad}
              onChange={(e) => {
                const limpio = e.target.value.replace(/[^0-9]/g, "");
                // Clampeado AL TIPEAR, no solo al registrar: el juez ve el
                // tope antes de mandarlo, no despues de una correccion.
                if (topeMax !== null && limpio !== "" && Number(limpio) > topeMax) {
                  setCantidad(String(topeMax));
                  return;
                }
                setCantidad(limpio);
              }}
              placeholder={String(confirmando ? progreso : paso.target || 0)}
              max={topeMax ?? undefined}
              className="w-full flex-1 rounded-3xl border border-neutral-700 bg-transparent px-4 text-center font-mono text-5xl outline-none focus:border-lime-400"
            />
            {topeMax !== null && (
              <p className="text-center text-xs text-neutral-600">Objetivo: {topeMax}</p>
            )}
            <button
              type="button"
              onClick={() => registrar(cantidad)}
              className="h-20 shrink-0 rounded-2xl bg-lime-400 text-2xl font-bold text-lime-950"
            >
              REGISTRAR
            </button>
          </div>
        ) : estilo === "hecho" ? (
          <button
            type="button"
            onClick={() => onCerrarMovimiento()}
            className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-3xl bg-lime-400 text-lime-950 active:bg-lime-300"
          >
            <span className="font-mono text-6xl font-black tabular-nums">
              {paso.maxReps ? "máx" : paso.target}
            </span>
            <span className="px-4 text-center text-2xl font-bold uppercase">
              {paso.name} listo
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRep}
            className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-3xl bg-lime-400 text-lime-950 active:bg-lime-300"
          >
            <span className="font-mono text-6xl font-black tabular-nums">
              {progreso}
              {!paso.maxReps && paso.target > 0 && (
                <span className="text-4xl opacity-60"> / {paso.target}</span>
              )}
            </span>
            <span className="text-2xl font-bold">+ REP</span>
          </button>
        )}
      </div>

      {/* NO REP es de primer nivel en los tres estilos: un no-rep no descuenta
          —esa repetición no cuenta y el atleta tiene que conseguir una válida—
          pero queda registrado, y es lo que hace defendible un reclamo. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={noRep}
          className="rounded-2xl border border-red-500/50 py-4 text-lg font-bold text-red-300 transition-transform active:scale-[0.99] active:bg-red-500/10"
        >
          NO REP
        </button>

        {estilo === "tap" && !confirmando ? (
          <button
            type="button"
            onClick={() => {
              setCantidad(String(progreso));
              setConfirmando(true);
            }}
            className="rounded-2xl border border-neutral-700 py-4 text-lg font-semibold text-neutral-300"
          >
            MOVIMIENTO ✓
          </button>
        ) : estilo === "hecho" ? (
          <button
            type="button"
            onClick={() => setContandoAMano(true)}
            className="rounded-2xl border border-neutral-700 py-4 text-lg font-semibold text-neutral-300"
          >
            CONTAR A MANO
          </button>
        ) : (
          <span />
        )}
      </div>

      {pidiendoMotivo && (
        // Targets de al menos 44px de alto: eran `py-1.5` (~34px), el unico
        // punto de esta pantalla por debajo del minimo tactil recomendado, y
        // justo en un flujo post-no-rep donde el juez puede estar apurado.
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-500">Motivo:</span>
          {MOTIVOS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onMotivo(m);
                setPidiendoMotivo(false);
              }}
              className="min-h-11 rounded-xl border border-neutral-700 px-3 text-sm text-neutral-300"
            >
              {m}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPidiendoMotivo(false)}
            className="ml-auto min-h-11 px-2 text-sm text-neutral-600"
          >
            omitir
          </button>
        </div>
      )}

      <p className="text-center text-sm text-neutral-500">
        {esAmrap
          ? `Ronda ${paso.round}`
          : paso.totalRounds > 1
            ? `Ronda ${paso.round} de ${paso.totalRounds}`
            : "Única ronda"}
        {paso.isTiebreak && " · marca el desempate"}
      </p>
    </section>
  );
}

/**
 * Carga máxima: N intentos, se queda con el mejor válido.
 *
 * Antes esto no tenia tope: el reductor nunca marcaba el carril como
 * terminado (ver `WodMovement.maxAttempts` en wod.ts), asi que la pantalla
 * seguia ofreciendo VALIDO/NULO para siempre y el WOD tampoco llegaba a
 * puntuar -el motor de scoring solo le pone marca a un carril "finished".
 * Con el tope resuelto en el reductor, acá solo queda mostrarlo: "Intento X
 * de N" mientras corre, y una pantalla de cierre igual de clara que la de
 * cualquier otro esquema en cuanto se agotan.
 */
function Intentos({
  kilos,
  setKilos,
  intentos,
  maxAttempts,
  mejor,
  terminado,
  onRegistrar,
}: {
  kilos: string;
  setKilos: (v: string) => void;
  intentos: Array<{ loadKg: number; valido: boolean }>;
  maxAttempts: number | null;
  mejor: number | null;
  terminado: boolean;
  onRegistrar: (valido: boolean) => void;
}) {
  const listaDeIntentos = intentos.length > 0 && (
    <p className="text-center text-sm text-neutral-400">
      {intentos.map((a, i) => (
        <span key={i} className={a.valido ? "text-lime-400" : "text-red-400"}>
          {a.valido ? "✓" : "✗"} {a.loadKg}
          {i < intentos.length - 1 && <span className="text-neutral-700"> · </span>}
        </span>
      ))}
    </p>
  );

  if (terminado) {
    return (
      <section className="flex h-[clamp(13rem,40dvh,20rem)] flex-col items-center justify-center gap-2 px-4">
        <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
          Carga máxima
        </span>
        <p className="text-3xl font-black">INTENTOS COMPLETOS</p>
        {mejor !== null ? (
          <p className="font-mono text-2xl">
            {mejor}
            <span className="ml-2 text-base font-sans font-normal text-neutral-500">kg</span>
          </p>
        ) : (
          <p className="text-lg text-neutral-500">Ningún intento válido</p>
        )}
        {listaDeIntentos}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 px-4 pt-4">
      <p className="text-center text-neutral-400">
        Intento {intentos.length + 1}
        {maxAttempts !== null && ` de ${maxAttempts}`}
      </p>
      <input
        inputMode="decimal"
        autoFocus
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

      {listaDeIntentos}
      {mejor !== null && (
        <p className="text-center text-lg font-bold">Mejor: {mejor} kg</p>
      )}
    </section>
  );
}

/**
 * Se acabo el tiempo con el atleta a mitad de un movimiento.
 *
 * Sin esto, esa cantidad no queda registrada en ningun lado: si eran 21 reps
 * y llevaba 12, esas 12 tienen que poder escribirse ANTES de que la pantalla
 * se bloquee — es justo lo que `resultado.awaitingFinalTally` habilita. Pide
 * SIEMPRE un numero (nunca "listo" a secas): en `hecho`/`numero` no hay
 * ningun tap previo que lo sepa, y en `tap` el numero ya viene precargado
 * con lo que se alcanzo a contar.
 */
function CierreDelTiempo({
  paso,
  progreso,
  onConfirmar,
}: {
  paso: WodStep;
  progreso: number;
  onConfirmar: (valor: number) => void;
}) {
  const [cantidad, setCantidad] = useState(String(progreso));

  // Mismo tope que en `Marcador`: el atleta no puede haber hecho mas que el
  // objetivo del paso que quedo a medias, y sin esto el juez podria tipear de
  // mas al cerrar en caliente, justo el momento con mas apuro.
  const topeMax = !paso.maxReps && paso.target > 0 ? paso.target : null;

  const confirmar = () => {
    const n = Number(cantidad);
    const acotado = topeMax !== null && n > topeMax ? topeMax : n;
    onConfirmar(Number.isFinite(acotado) && cantidad !== "" ? acotado : progreso);
  };

  return (
    <section className="flex flex-col gap-3 px-4 pt-4">
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-center">
        <p className="text-lg font-black text-amber-300">SE ACABÓ EL TIEMPO</p>
        <p className="mt-1 text-sm text-amber-200/80">
          ¿Cuántas hizo en {paso.name.toLowerCase()}?
        </p>
      </div>

      <div className="flex h-[clamp(13rem,40dvh,20rem)] flex-col gap-2">
        <input
          inputMode="numeric"
          autoFocus
          value={cantidad}
          onChange={(e) => {
            const limpio = e.target.value.replace(/[^0-9]/g, "");
            if (topeMax !== null && limpio !== "" && Number(limpio) > topeMax) {
              setCantidad(String(topeMax));
              return;
            }
            setCantidad(limpio);
          }}
          max={topeMax ?? undefined}
          className="w-full flex-1 rounded-3xl border border-amber-500/50 bg-transparent px-4 text-center font-mono text-5xl outline-none focus:border-amber-400"
        />
        {topeMax !== null && (
          <p className="text-center text-xs text-amber-200/60">Objetivo: {topeMax}</p>
        )}
        <button
          type="button"
          onClick={confirmar}
          className="h-20 shrink-0 rounded-2xl bg-amber-400 text-2xl font-bold text-amber-950"
        >
          REGISTRAR
        </button>
      </div>
    </section>
  );
}

/** Como se llama el esquema en la pizarra, para que el titulo diga QUE TIPO de WOD cerro. */
const ETIQUETA_ESQUEMA: Record<string, string> = {
  ventana: "AMRAP",
  cap: "FOR TIME",
  libre: "FOR TIME",
  intervalos: "INTERVALOS",
};

/**
 * La pantalla de cierre, y por que el dato principal cambia con el esquema.
 *
 * "TERMINÓ · 8:42" no dice nada de un AMRAP capeado a medio chipper, y
 * "CAPEADO · 63 reps" no dice nada de un For Time que en realidad completo 3
 * rondas y media -el juez tiene que poder leer el resultado SIN hacer la
 * cuenta el mismo. La regla:
 *
 *   - AMRAP: siempre rondas + reps, nunca un tiempo (no lo tiene).
 *   - Cerro con tiempo (completo antes del cap): el tiempo, que es el dato
 *     que define un For Time.
 *   - Cualquier otro cierre (capeado, DNF, DQ) en un WOD de mas de una
 *     ronda: rondas + reps, igual que un AMRAP -es la misma pregunta
 *     ("¿hasta donde llego?") aunque el esquema no sea ventana.
 *   - Una sola ronda sin tiempo: reps a secas.
 */
function Cerrado({
  resultado,
  esquema,
  plan,
}: {
  resultado: NonNullable<ReturnType<typeof reduceWodEvents>>;
  esquema: string;
  plan: WodStep[];
}) {
  const titulo =
    resultado.status === "dq"
      ? "DESCALIFICADO"
      : resultado.status === "dnf"
        ? "NO TERMINÓ"
        : resultado.capped
          ? "CAPEADO"
          : "TERMINÓ";

  const etiqueta = ETIQUETA_ESQUEMA[esquema];
  const multiRonda = plan.some((p) => p.totalRounds > 1);

  return (
    <section className="flex h-[clamp(13rem,40dvh,20rem)] flex-col items-center justify-center gap-2 px-4">
      {etiqueta && (
        <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs font-semibold tracking-widest text-neutral-500 uppercase">
          {etiqueta}
        </span>
      )}
      <p className="text-3xl font-black">{titulo}</p>
      {esquema === "ventana" || (multiRonda && resultado.finishedMs === null) ? (
        <p className="font-mono text-2xl">
          {resultado.completedRounds} rondas + {resultado.repsInRound}
          <span className="ml-2 text-base font-sans font-normal text-neutral-500">reps</span>
        </p>
      ) : resultado.finishedMs !== null ? (
        <p className="font-mono text-2xl">{formatElapsed(resultado.finishedMs)}</p>
      ) : (
        <p className="font-mono text-2xl">
          {resultado.completedReps}
          <span className="ml-2 text-base font-sans font-normal text-neutral-500">reps</span>
        </p>
      )}
      {resultado.noRepCount > 0 && (
        <p className="text-sm text-red-400">{resultado.noRepCount} no reps</p>
      )}
      {resultado.tiebreakMs !== null && (
        <p className="text-sm text-neutral-500">desempate {formatElapsed(resultado.tiebreakMs)}</p>
      )}
    </section>
  );
}

function Progreso({
  resultado,
  esquema,
  plan,
  siguiente,
  terminado,
}: {
  resultado: NonNullable<ReturnType<typeof reduceWodEvents>>;
  esquema: string;
  plan: WodStep[];
  /** El paso que viene, o null si este es el ultimo. */
  siguiente: WodStep | null;
  /** Con el WOD cerrado, `Cerrado` ya muestra ronda/reps y no-reps: repetirlo
   *  aca abajo es la misma informacion dos veces en la misma pantalla. */
  terminado: boolean;
}) {
  // El resumen habla en RONDAS Y MOVIMIENTO, no en el indice plano del plan:
  // un juez piensa "ronda 3 de 3, thruster", no "paso 5 de 6" — y ese numero
  // de paso fue justo lo que se leyo como una cuenta rara cuando el WOD se
  // dejaba cerrar despues del cap. Cuando ya no queda paso actual (WOD
  // completo) se usa el ultimo del plan, que tiene la ronda final.
  const pasoDeReferencia =
    resultado.currentStepIndex != null ? plan[resultado.currentStepIndex] : plan.at(-1);

  return (
    <>
    {/* LO QUE VIENE, EN UNA CAJA PROPIA Y GRANDE: es lo que el juez tiene que
        poder leer de reojo y decirle al atleta o al corredor de material sin
        entrecerrar los ojos -antes era una linea gris chica, facil de perder
        justo debajo del marcador. */}
    {siguiente && (
      <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-2.5">
        <span className="shrink-0 text-[11px] font-bold tracking-widest text-neutral-500 uppercase">
          Sigue
        </span>
        <p className="min-w-0 flex-1 truncate text-right text-lg font-bold text-neutral-100">
          {siguiente.maxReps ? "Máx" : siguiente.target} {siguiente.name}
          {siguiente.loadKg !== null && (
            <span className="ml-2 font-mono text-base font-normal text-neutral-400">
              {formatearCarga(siguiente.loadKg, siguiente.loadUnit)}
            </span>
          )}
        </p>
      </div>
    )}

    {!terminado && (
      <section className="flex flex-wrap justify-center gap-x-5 gap-y-1 px-4 text-sm text-neutral-400">
        {esquema === "ventana" ? (
          <span>
            Ronda {resultado.completedRounds + 1} · {resultado.completedReps} reps
          </span>
        ) : pasoDeReferencia ? (
          <span>
            {pasoDeReferencia.totalRounds > 1
              ? `Ronda ${pasoDeReferencia.round} de ${pasoDeReferencia.totalRounds}`
              : "Única ronda"}
            {" · "}
            {pasoDeReferencia.name}
          </span>
        ) : null}
        {resultado.noRepCount > 0 && (
          <span className="text-red-400">{resultado.noRepCount} no reps</span>
        )}
        {resultado.tiebreakMs !== null && (
          <span>desempate {formatElapsed(resultado.tiebreakMs)}</span>
        )}
      </section>
    )}
    </>
  );
}
