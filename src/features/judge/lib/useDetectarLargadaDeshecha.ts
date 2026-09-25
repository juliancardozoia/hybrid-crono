"use client";

import { useEffect } from "react";
import type { HeatStartCheck } from "./bundle";
import { useRaceStore } from "./store";

/** Cada cuanto se le pregunta al servidor si la largada sigue en pie. */
export const INTERVALO_DE_LARGADA_MS = 2_000;

/**
 * Detecta si la organización deshizo la largada de un heat DESPUÉS de que el
 * juez ya la tenía anclada.
 *
 * `EsperandoLargada` solo pregunta la largada ANTES de que exista el ancla.
 * Una vez que existe, nada volvía a preguntar — y el ancla se pone sola en
 * cuanto llega `heatStartEpochMs`, sin que el juez tenga que tocar nada. Sin
 * este chequeo, una largada deshecha por la organización dejaba el reloj del
 * juez corriendo sobre un heat que en la base ya no arrancó.
 *
 * LA SEÑAL ES LA GENERACIÓN, no la ausencia de respuesta. Cada vez que se
 * deshace una largada `heats.start_generation` sube, y el ancla recuerda con
 * cuál se creó: si el servidor informa una MAYOR, esa largada se deshizo y no
 * hay otra lectura posible. Antes se leía "el heat no arrancó" y como un
 * error de red se veía igual hacían falta tres respuestas seguidas (15s)
 * para no resetear a un juez por un bache de señal. Con la generación una
 * sola respuesta alcanza, y una respuesta que no llegó (`null`) simplemente no
 * concluye nada.
 *
 * Al soltar el reloj NO se borra ningún marcaje (ver `syncGeneration` en el
 * store): lo que todavía no subió sigue en la cola y sube igual.
 */
export function useDetectarLargadaDeshecha(
  onCheckStart: (() => Promise<HeatStartCheck | null>) | undefined,
  online: boolean,
  /** Se llama cuando se suelta el reloj, para que la pantalla pueda avisar. */
  onDeshecha?: () => void,
): void {
  const hayReloj = useRaceStore((s) => s.anchor !== null);
  const status = useRaceStore((s) => s.result?.status);
  const syncGeneration = useRaceStore((s) => s.syncGeneration);

  const terminado = status === "finished" || status === "dnf" || status === "dq";

  useEffect(() => {
    if (!onCheckStart || !online || !hayReloj || terminado) return;

    let cancelado = false;

    const timer = setInterval(async () => {
      const check = await onCheckStart();
      if (cancelado || !check) return;

      const deshecha = await syncGeneration(check.generation);
      if (!cancelado && deshecha) onDeshecha?.();
    }, INTERVALO_DE_LARGADA_MS);

    return () => {
      cancelado = true;
      clearInterval(timer);
    };
  }, [onCheckStart, online, hayReloj, terminado, syncGeneration, onDeshecha]);
}
