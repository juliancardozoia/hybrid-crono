"use client";

import { useEffect } from "react";
import { useRaceStore } from "./store";

/**
 * Detecta si la organización deshizo la largada de un heat DESPUÉS de que el
 * juez ya la tenía anclada.
 *
 * `EsperandoLargada` solo pregunta la largada ANTES de que exista el ancla.
 * Una vez que existe, nada volvía a preguntar — y el ancla se pone sola en
 * cuanto llega `heatStartEpochMs`, sin que el juez tenga que tocar nada, así
 * que un heat recién largado y sin ningún marcaje todavía puede tener el
 * reloj de un juez corriendo. `cancel_heat_start` justamente solo funciona
 * en ese estado (heat sin marcajes). Sin este chequeo, una falsa largada
 * deshecha por la organización dejaba el reloj del juez corriendo sobre un
 * heat que en la base ya no arrancó — y cualquier marcaje que hiciera
 * después quedaba huérfano de una largada inexistente.
 *
 * TRES RESPUESTAS SEGUIDAS EN "NO ARRANCÓ", no una sola. `onCheckStart` come
 * un error de red y lo devuelve como `null` (ver `checkStart` en
 * CarrilClient.tsx) para que el polling de espera no se corte por un bache
 * de señal — pero eso significa que un `null` solo no distingue "la
 * organización deshizo la largada" de "no hubo señal por diez segundos". Se
 * exige que se repita tres veces (15s) antes de reiniciar el carril.
 */
export function useDetectarLargadaDeshecha(
  onCheckStart: (() => Promise<number | null>) | undefined,
  online: boolean,
  /** Se llama justo antes de reiniciar, para que la pantalla pueda avisar. */
  onDeshecha?: () => void,
): void {
  const anchor = useRaceStore((s) => s.anchor);
  const status = useRaceStore((s) => s.result?.status);
  const reset = useRaceStore((s) => s.reset);

  const terminado = status === "finished" || status === "dnf" || status === "dq";

  useEffect(() => {
    if (!onCheckStart || !online || !anchor || terminado) return;

    let cancelado = false;
    let nulosSeguidos = 0;

    const timer = setInterval(async () => {
      const epoch = await onCheckStart();
      if (cancelado) return;

      if (epoch === null) {
        nulosSeguidos += 1;
        if (nulosSeguidos >= 3) {
          onDeshecha?.();
          await reset();
        }
      } else {
        nulosSeguidos = 0;
      }
    }, 5_000);

    return () => {
      cancelado = true;
      clearInterval(timer);
    };
  }, [onCheckStart, online, anchor, terminado, reset, onDeshecha]);
}
