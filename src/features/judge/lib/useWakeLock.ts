"use client";

import { useEffect } from "react";

/**
 * Mantiene la pantalla encendida mientras el carril corre.
 *
 * El navegador suelta el lock solo cuando la pestana pasa a segundo plano, asi
 * que hay que volver a pedirlo al regresar. Si el dispositivo no soporta la API
 * no pasa nada: el cronometro no depende de esto, es comodidad para el juez.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denegado o sin soporte: seguimos igual.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !released) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
