"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import { planDelWod, type CaptureStyle, type WodStep, type WodStructure } from "@/shared/timing/wod";
import { formatearCarga } from "@/shared/unidades/carga";

/**
 * Simulacion, TODO VISUAL, de la pantalla del juez para esta prueba.
 *
 * NO ES `WodJudgeScreen`: no toca IndexedDB, no abre ningun carril, no
 * sincroniza nada y no depende de que exista un heat largado. Es la misma UI
 * —los mismos tres estilos de captura, los mismos botones, el mismo texto—
 * pero con estado local que se tira apenas se cierra el modal. El objetivo es
 * que el organizador vea COMO SE USA antes del dia de la competencia, cuando
 * un error (una escalera invertida, un objetivo en cero) todavia se puede
 * corregir sin perder un tiempo real.
 *
 * `planDelWod` es la misma funcion pura que usa el juez de verdad: si esta
 * vista previa miente, el juez ve lo mismo que miente.
 */

const UNIDAD_CORTA: Record<string, string> = {
  reps: "reps",
  metros: "m",
  calorias: "cal",
  segundos: "s",
  kg: "kg",
};

const MOTIVOS = ["profundidad", "lockout", "contacto", "línea"];

const PENALIZACIONES_DE_EJEMPLO = [
  { label: "No rep en la barra", texto: "+10s" },
  { label: "Salida en falso", texto: "+5s" },
  { label: "Descalificación", texto: "DQ" },
];

export function VistaPreviaInteractivaWod({ estructura }: { estructura: WodStructure }) {
  const plan = useMemo(() => planDelWod(estructura), [estructura]);

  const [pasoIndex, setPasoIndex] = useState(0);
  const [progreso, setProgreso] = useState(0);
  const [noReps, setNoReps] = useState(0);
  const [terminado, setTerminado] = useState<"ok" | "dnf" | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [inicioMs, setInicioMs] = useState<number | null>(null);
  const [ahoraMs, setAhoraMs] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!corriendo) return;
    const timer = setInterval(() => setAhoraMs(Date.now()), 100);
    return () => clearInterval(timer);
  }, [corriendo]);

  if (plan.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-neutral-800 p-4 text-center text-sm text-neutral-600">
        Sin pasos todavía. Agrega un bloque con sus movimientos para poder
        simular la pantalla del juez.
      </p>
    );
  }

  const paso: WodStep | null = terminado ? null : (plan[pasoIndex] ?? null);
  const elapsedMs = inicioMs !== null && ahoraMs !== null ? ahoraMs - inicioMs : 0;

  function empezar() {
    const ahora = Date.now();
    setInicioMs(ahora);
    setAhoraMs(ahora);
    setCorriendo(true);
  }

  function reiniciar() {
    setPasoIndex(0);
    setProgreso(0);
    setNoReps(0);
    setTerminado(null);
    setCorriendo(false);
    setInicioMs(null);
    setAhoraMs(null);
    setSheetOpen(false);
  }

  function cerrarMovimiento() {
    setProgreso(0);
    if (pasoIndex + 1 >= plan.length) {
      setTerminado("ok");
      setCorriendo(false);
    } else {
      setPasoIndex((i) => i + 1);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-neutral-100">
      <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs font-semibold tracking-wide text-amber-300 uppercase">
        Vista previa — nada se guarda, no hay conexión
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="text-center">
          <p className="font-mono text-4xl font-bold tabular-nums">
            {corriendo || terminado ? formatElapsed(elapsedMs, { centis: false }) : "00:00"}
          </p>
          <p className="text-xs text-neutral-500">
            {terminado ? "detenido" : corriendo ? "transcurrido (simulado)" : "sin largar"}
          </p>
        </div>

        {!corriendo && !terminado && (
          <button
            type="button"
            onClick={empezar}
            className="rounded-2xl border border-lime-400/50 bg-lime-400/10 py-3 text-sm font-bold text-lime-300"
          >
            SIMULAR LARGADA
          </button>
        )}

        {terminado && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-3xl border border-neutral-800">
            <p className="text-2xl font-black">
              {terminado === "dnf" ? "NO TERMINÓ (simulado)" : "TERMINÓ (simulado)"}
            </p>
            <p className="font-mono text-lg text-neutral-400">{formatElapsed(elapsedMs)}</p>
          </div>
        )}

        {corriendo && paso && (
          <Marcador
            key={paso.index}
            paso={paso}
            progreso={progreso}
            onRep={() => setProgreso((p) => p + 1)}
            onNoRep={() => setNoReps((n) => n + 1)}
            onConfirmarCantidad={(valor) => {
              setProgreso(valor);
              cerrarMovimiento();
            }}
            onCerrarSinCantidad={cerrarMovimiento}
          />
        )}

        {corriendo && (
          <p className="text-center text-xs text-neutral-500">
            {paso ? (
              <>
                Paso {pasoIndex + 1} de {plan.length}
                {noReps > 0 && <span className="ml-2 text-red-400">{noReps} no rep(s)</span>}
              </>
            ) : null}
          </p>
        )}

        {(corriendo || terminado) && (
          <div className="flex gap-2">
            {corriendo && (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="flex-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 text-sm font-semibold text-amber-300"
              >
                PENALIZAR
              </button>
            )}
            {corriendo && (
              <button
                type="button"
                onClick={() => {
                  setTerminado("dnf");
                  setCorriendo(false);
                }}
                className="flex-1 rounded-xl border border-neutral-800 py-2.5 text-sm text-neutral-500"
              >
                Marcar DNF
              </button>
            )}
            {terminado && (
              <button
                type="button"
                onClick={reiniciar}
                className="flex-1 rounded-xl border border-neutral-700 py-2.5 text-sm text-neutral-300"
              >
                Simular de nuevo
              </button>
            )}
          </div>
        )}
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="rounded-t-3xl border-t border-neutral-700 bg-neutral-900 p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="mb-1 text-sm font-bold">Aplicar penalización (ejemplo)</h4>
            <p className="mb-4 text-xs text-neutral-500">
              Las penalizaciones reales de tu evento se cargan en “Penalizaciones”.
            </p>
            <ul className="space-y-2">
              {PENALIZACIONES_DE_EJEMPLO.map((p) => (
                <li key={p.label}>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="flex w-full items-center justify-between rounded-2xl border border-neutral-700 px-4 py-3 text-left text-sm"
                  >
                    <span className="font-semibold">{p.label}</span>
                    <span className="font-mono text-amber-400">{p.texto}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="mt-4 w-full py-3 text-center text-sm text-neutral-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Recorte de la caja interactiva de `WodJudgeScreen`: los tres estilos de
 * captura (tap / hecho / número), con los mismos textos y la misma altura
 * fija. Estado 100% local: nada de esto emite un evento ni escribe nada.
 */
function Marcador({
  paso,
  progreso,
  onRep,
  onNoRep,
  onConfirmarCantidad,
  onCerrarSinCantidad,
}: {
  paso: WodStep;
  progreso: number;
  onRep: () => void;
  onNoRep: () => void;
  onConfirmarCantidad: (valor: number) => void;
  onCerrarSinCantidad: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [cantidad, setCantidad] = useState("");
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const estilo: CaptureStyle = paso.captureStyle;
  const escribiendo = confirmando || estilo === "numero";

  const registrar = () => {
    const n = Number(cantidad);
    onConfirmarCantidad(Number.isFinite(n) && cantidad !== "" ? n : progreso);
    setCantidad("");
    setConfirmando(false);
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-lg font-bold uppercase">{paso.name}</p>
        <p className="text-sm text-neutral-400">
          {paso.loadKg !== null && formatearCarga(paso.loadKg, paso.loadUnit)}
        </p>
      </div>

      {estilo !== "tap" && (
        <p className="text-center text-sm text-neutral-400">
          {paso.maxReps ? "Hasta que suene" : `${paso.target} ${UNIDAD_CORTA[paso.unit] ?? paso.unit}`}
        </p>
      )}

      <div className="flex h-40 flex-col">
        {escribiendo ? (
          <div className="flex h-full flex-col gap-2">
            <input
              ref={inputRef}
              inputMode="numeric"
              autoFocus
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={String(confirmando ? progreso : paso.target || 0)}
              className="w-full flex-1 rounded-2xl border border-neutral-700 bg-transparent px-4 text-center font-mono text-3xl outline-none focus:border-lime-400"
            />
            <button
              type="button"
              onClick={registrar}
              className="h-12 shrink-0 rounded-xl bg-lime-400 text-lg font-bold text-lime-950"
            >
              REGISTRAR
            </button>
          </div>
        ) : estilo === "hecho" ? (
          <button
            type="button"
            onClick={onCerrarSinCantidad}
            className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl bg-lime-400 text-lime-950 active:bg-lime-300"
          >
            <span className="font-mono text-4xl font-black tabular-nums">
              {paso.maxReps ? "máx" : paso.target}
            </span>
            <span className="px-4 text-center text-lg font-bold uppercase">{paso.name} listo</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRep}
            className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-2xl bg-lime-400 text-lime-950 active:bg-lime-300"
          >
            <span className="font-mono text-4xl font-black tabular-nums">
              {progreso}
              {!paso.maxReps && paso.target > 0 && (
                <span className="text-2xl opacity-60"> / {paso.target}</span>
              )}
            </span>
            <span className="text-lg font-bold">+ REP</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            onNoRep();
            setPidiendoMotivo(true);
          }}
          className="rounded-xl border border-red-500/50 py-2.5 text-sm font-bold text-red-300"
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
            className="rounded-xl border border-neutral-700 py-2.5 text-sm font-semibold text-neutral-300"
          >
            MOVIMIENTO ✓
          </button>
        ) : estilo === "hecho" ? (
          <span className="flex items-center justify-center rounded-xl border border-neutral-800 py-2.5 text-center text-xs text-neutral-600">
            &ldquo;CONTAR A MANO&rdquo; en la app real
          </span>
        ) : (
          <span />
        )}
      </div>

      {pidiendoMotivo && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">Motivo:</span>
          {MOTIVOS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPidiendoMotivo(false)}
              className="rounded-lg border border-neutral-700 px-2 py-1 text-xs text-neutral-300"
            >
              {m}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPidiendoMotivo(false)}
            className="ml-auto px-2 text-xs text-neutral-600"
          >
            omitir
          </button>
        </div>
      )}

      <p className="text-center text-xs text-neutral-500">
        {paso.totalRounds > 1 ? `Ronda ${paso.round} de ${paso.totalRounds}` : "Única ronda"}
        {paso.isTiebreak && " · marca el desempate"}
      </p>
    </section>
  );
}
