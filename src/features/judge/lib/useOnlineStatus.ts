"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Estado de red.
 *
 * Va por useSyncExternalStore en vez de un useEffect con setState porque la
 * conectividad es exactamente eso: un sistema externo al que React se suscribe.
 * Ademas evita el parpadeo de "offline" en el primer render.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // en el render del servidor asumimos que hay red
  );
}
