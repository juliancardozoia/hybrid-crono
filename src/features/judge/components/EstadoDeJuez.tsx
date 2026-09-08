"use client";

import { useEffect, useRef } from "react";
import { formatElapsed } from "@/shared/timing/clock";

/**
 * Piezas de estado compartidas entre JudgeScreen (circuito) y WodJudgeScreen
 * (CrossFit): barra de conexion, aviso de drift del reloj, y la ranura de
 * Deshacer. Las dos pantallas de juez tienen que leerse como el mismo
 * lenguaje operacional aunque el marcaje en si sea distinto — antes cada una
 * tenia su propio wording ("En linea"/"En línea"/"Offline") y su propio color
 * para Deshacer, uno de los cuales (ambar) coincidia con el de "Penalizar" en
 * la misma pantalla.
 */

export function BarraDeEstadoJuez({
  online,
  pendientes,
  persistido,
}: {
  online: boolean;
  pendientes: number;
  persistido: boolean;
}) {
  const sincronizado = pendientes === 0;
  const tono = online && sincronizado ? "text-emerald-400" : "text-amber-400";

  return (
    <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-5 py-2 text-sm">
      <span className={`flex items-center gap-2 font-medium ${tono}`}>
        <span className="text-lg leading-none">●</span>
        {online ? "En línea" : "Sin conexión"}
      </span>
      <span className={sincronizado ? "text-neutral-500" : "font-semibold text-amber-400"}>
        {sincronizado ? "Todo sincronizado" : `${pendientes} sin sincronizar`}
      </span>
      {!persistido && (
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
 * El reloj se ajusto solo al llegar la largada oficial (o al reconectar).
 *
 * Color `sky`: no es una alarma (ambar) ni un error (rojo), es informativo —
 * el sistema se corrigio solo y el juez no tiene que hacer nada. Antes
 * JudgeScreen lo pintaba `sky` y WodJudgeScreen `neutral`, dos tratamientos
 * para el mismo concepto.
 */
export function AvisoDeDrift({ anchorDriftMs }: { anchorDriftMs: number | null }) {
  if (anchorDriftMs === null || anchorDriftMs === 0) return null;

  return (
    <p className="mx-4 mt-3 rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-200 sm:mx-5">
      El reloj se ajustó {formatElapsed(Math.abs(anchorDriftMs), { centis: false })} al llegar la
      salida oficial. Tus marcas se corrigieron solas.
    </p>
  );
}

/**
 * La ranura de Deshacer, compartida.
 *
 * Reserva SIEMPRE el mismo alto (`h-[5.5rem]`) este vacia o no: si apareciera
 * y desapareciera, el resto de los controles se correria hacia arriba y abajo
 * en cada marcaje, y el juez ya aprendio donde apoyar el pulgar.
 *
 * Color `sky`, no `amber`: "Penalizar" (solo circuito) ya es ambar, y
 * Deshacer/Penalizar son acciones OPUESTAS — una revierte, la otra empeora el
 * resultado. Compartir el mismo tono las hacia indistinguibles de reojo.
 */
export function RanuraDeDeshacer({
  undoTarget,
  onUndo,
  subtitulo = "último marcaje",
}: {
  undoTarget: { expiresAt: number } | null;
  onUndo: () => void;
  /** Circuito dice "marcaje", CrossFit dice "marca": mismo componente, un
   *  matiz de vocabulario que ya usa cada flujo en el resto de la pantalla. */
  subtitulo?: string;
}) {
  return (
    <div className="mt-3 h-[5.5rem] shrink-0">
      {undoTarget && (
        <button
          type="button"
          onClick={onUndo}
          className="flex h-full w-full items-center justify-between rounded-2xl border-2 border-sky-400 bg-sky-400/15 px-5 text-left transition-transform active:scale-[0.99] active:bg-sky-400/25"
        >
          <span className="flex items-center gap-3">
            <span className="text-3xl leading-none text-sky-300">↺</span>
            <span>
              <span className="block text-xl font-black tracking-wide text-sky-200">DESHACER</span>
              <span className="block text-xs text-sky-300/70">{subtitulo}</span>
            </span>
          </span>
          <Countdown
            expiresAt={undoTarget.expiresAt}
            className="font-mono text-3xl font-bold text-sky-300 tabular-nums"
          />
        </button>
      )}
    </div>
  );
}

/**
 * Segundos que quedan de la ventana de deshacer.
 *
 * Escribe al nodo DIRECTO cada 100ms: un valor que cambia diez veces por
 * segundo no tiene por que re-renderizar toda la pantalla del juez, misma
 * doctrina que LiveClock/Countdown del reloj principal.
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
