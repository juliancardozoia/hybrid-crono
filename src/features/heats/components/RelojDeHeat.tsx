"use client";

import { useEffect, useRef } from "react";
import { formatElapsed } from "@/shared/timing/clock";

/**
 * Cuanto lleva corriendo un heat, en vivo.
 *
 * Escribe al DOM directo con requestAnimationFrame, igual que LiveClock del
 * juez: es la misma regla de rendimiento (el reloj no pasa por React) pero
 * aca para la torre de control, que puede tener varios heats en curso a la
 * vez en la misma pantalla.
 *
 * Sin centesimas: a esta escala —"cuanto lleva el heat", no el tiempo de un
 * atleta— importan los segundos, no las centesimas.
 */
export function RelojDeHeat({
  startedAtIso,
  className,
}: {
  startedAtIso: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const inicioMs = new Date(startedAtIso).getTime();
    let frame = 0;

    const tick = () => {
      node.textContent = formatElapsed(Date.now() - inicioMs, { centis: false });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [startedAtIso]);

  return <span ref={ref} className={className} suppressHydrationWarning />;
}
