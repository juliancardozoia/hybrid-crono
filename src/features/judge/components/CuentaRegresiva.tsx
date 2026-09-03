"use client";

import { useEffect, useRef } from "react";
import { elapsedFromAnchor, formatElapsed, type ClockAnchor } from "@/shared/timing/clock";

/**
 * El reloj de un AMRAP: cuenta hacia atras y se congela en cero.
 *
 * Escribe al nodo del DOM con requestAnimationFrame, igual que LiveClock y por
 * la misma razon: un WOD de veinte minutos re-renderizando el arbol sesenta
 * veces por segundo le come la bateria al juez.
 */
export function CuentaRegresiva({
  anchor,
  duracionMs,
  className,
  onLlegarACero,
}: {
  anchor: ClockAnchor | null;
  duracionMs: number;
  className?: string;
  /** Se llama una sola vez cuando el reloj llega a cero. */
  onLlegarACero?: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const avisado = useRef(false);
  const callback = useRef(onLlegarACero);
  // El patron de "ref siempre al dia": escribirlo durante el render lo rechaza
  // el linter de React 19, y con razon — un render descartado dejaria el ref
  // apuntando a un callback que nunca se monto.
  useEffect(() => {
    callback.current = onLlegarACero;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (!anchor) {
      node.textContent = formatElapsed(duracionMs);
      return;
    }

    let frame = 0;
    const tick = () => {
      const restante = duracionMs - elapsedFromAnchor(anchor, performance.now());
      node.textContent = formatElapsed(Math.max(0, restante));

      if (restante <= 0 && !avisado.current) {
        avisado.current = true;
        callback.current?.();
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [anchor, duracionMs]);

  return (
    <span ref={ref} className={className} suppressHydrationWarning>
      {formatElapsed(duracionMs)}
    </span>
  );
}
