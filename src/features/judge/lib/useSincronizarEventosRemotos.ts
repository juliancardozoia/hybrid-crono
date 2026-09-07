"use client";

import { useEffect } from "react";
import { fetchLaneEvents } from "./bundle";
import { useRaceStore } from "./store";

/**
 * Trae y mezcla eventos que insertó OTRA PERSONA -no este dispositivo-.
 *
 * `startSyncLoop` (ver sync.ts) es de solo SUBIDA: empuja la cola local y
 * nunca pregunta que hay nuevo del lado del servidor. Un DNF marcado desde la
 * torre de control (`marcarDnf`, otro `deviceId`) quedaba invisible para el
 * juez: su reloj seguía corriendo sobre un heat que para el servidor ya
 * había terminado. Mismo hueco en el sentido contrario -un juez que marca DNF
 * y la organización no lo ve sin recargar- lo resuelve `TorreDeHeats`
 * refrescándose sola.
 *
 * Cada 5s mientras el carril siga sin terminar, igual que
 * `useDetectarLargadaDeshecha`.
 */
export function useSincronizarEventosRemotos(laneId: string, online: boolean): void {
  const anchor = useRaceStore((s) => s.anchor);
  const status = useRaceStore((s) => s.result?.status);
  const mergeRemoteEvents = useRaceStore((s) => s.mergeRemoteEvents);

  const terminado = status === "finished" || status === "dnf" || status === "dq";

  useEffect(() => {
    if (!online || !anchor || terminado) return;

    let cancelado = false;
    const timer = setInterval(async () => {
      const remotos = await fetchLaneEvents(laneId).catch(() => []);
      if (!cancelado && remotos.length > 0) await mergeRemoteEvents(remotos);
    }, 5_000);

    return () => {
      cancelado = true;
      clearInterval(timer);
    };
  }, [laneId, online, anchor, terminado, mergeRemoteEvents]);
}
