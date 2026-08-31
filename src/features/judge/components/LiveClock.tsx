"use client";

import { useEffect, useRef } from "react";
import { elapsedFromAnchor, formatElapsed, type ClockAnchor } from "@/shared/timing/clock";

/**
 * El reloj corriendo.
 *
 * Escribe el tiempo directo al nodo del DOM con requestAnimationFrame en vez de
 * pasar por el estado de React. Una carrera dura 90 minutos: re-renderizar el
 * arbol 60 veces por segundo todo ese rato le funde la bateria al juez, que es
 * justo el recurso que no podemos gastar.
 */
export function LiveClock({
  anchor,
  frozenMs,
  className,
}: {
  anchor: ClockAnchor | null;
  /** Si esta seteado, el reloj se detiene en este valor (carrera terminada). */
  frozenMs?: number | null;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (frozenMs != null) {
      node.textContent = formatElapsed(frozenMs);
      return;
    }

    if (!anchor) {
      node.textContent = formatElapsed(0);
      return;
    }

    let frame = 0;
    const tick = () => {
      node.textContent = formatElapsed(elapsedFromAnchor(anchor, performance.now()));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [anchor, frozenMs]);

  return (
    <span ref={ref} className={className} suppressHydrationWarning>
      {formatElapsed(frozenMs ?? 0)}
    </span>
  );
}
