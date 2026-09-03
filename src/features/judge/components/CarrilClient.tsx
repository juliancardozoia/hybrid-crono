"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fetchHeatStart, resolveLaneBundle, type LaneBundle } from "../lib/bundle";
import { JudgeScreen } from "./JudgeScreen";
import { WodJudgeScreen } from "./WodJudgeScreen";

type Estado =
  | { fase: "cargando" }
  | { fase: "listo"; bundle: LaneBundle; desdeCache: boolean }
  | { fase: "sin-datos"; motivo: string };

/**
 * Pantalla del cronometro.
 *
 * El carril llega por query string y no por segmento de ruta a proposito: asi
 * esta pagina es estatica y el service worker puede servirla sin red. Una ruta
 * dinamica con SSR no se puede precachear, y un juez que reinicia el celular en
 * medio del heat sin señal no veria nada.
 */
export function CarrilClient() {
  const searchParams = useSearchParams();
  const laneId = searchParams.get("id");
  const [carga, setCarga] = useState<Estado>({ fase: "cargando" });

  // Sin id no hay nada que cargar, y eso se deriva del render: meterlo en un
  // efecto seria un setState sincrono que solo dispara un render de mas.
  const estado: Estado = laneId
    ? carga
    : { fase: "sin-datos", motivo: "No se indicó ningún carril." };

  useEffect(() => {
    if (!laneId) return;

    let cancelado = false;

    const cargar = async () => {
      const { bundle, desdeCache } = await resolveLaneBundle(laneId).then((r) => ({
        bundle: r.bundle,
        desdeCache: r.fromCache,
      }));

      if (cancelado) return;

      setCarga(
        bundle
          ? { fase: "listo", bundle, desdeCache }
          : {
              fase: "sin-datos",
              motivo: navigator.onLine
                ? "No encontramos este carril, o no está asignado a tu organización."
                : "Este carril nunca se abrió con conexión, así que no hay datos guardados en el dispositivo.",
            },
      );
    };

    void cargar();
    return () => {
      cancelado = true;
    };
  }, [laneId]);

  const bundle = estado.fase === "listo" ? estado.bundle : null;
  const heatId = bundle?.heatId;

  const checkStart = useCallback(async (): Promise<number | null> => {
    if (!heatId) return null;
    try {
      const iso = await fetchHeatStart(heatId);
      return iso ? new Date(iso).getTime() : null;
    } catch {
      return null;
    }
  }, [heatId]);

  if (estado.fase === "cargando") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-neutral-950 text-neutral-500">
        <p>Cargando carril…</p>
      </main>
    );
  }

  if (estado.fase === "sin-datos") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-neutral-950 px-8 text-center text-neutral-300">
        <p className="text-lg font-semibold">No se puede abrir el carril</p>
        <p className="text-sm text-neutral-500">{estado.motivo}</p>
        <Link href="/juez" className="rounded-xl border border-neutral-700 px-5 py-3 text-sm">
          Volver a mis carriles
        </Link>
      </main>
    );
  }

  // LA APP DECIDE QUE VA A JUZGAR, EL JUEZ NO ELIGE NADA.
  //
  // Si la prueba del carril tiene partes de CrossFit, monta la pantalla de
  // repeticiones; si no, la de circuito. Las dos viven en el mismo bundle
  // precacheado y en la misma ruta estatica, asi que la decision no cuesta una
  // consulta ni rompe el offline.
  const partes = estado.bundle.wod ?? [];

  if (partes.length > 0) {
    return (
      <WodJudgeScreen
        laneId={estado.bundle.laneId}
        bib={estado.bundle.bib !== null ? String(estado.bundle.bib) : "—"}
        athlete={estado.bundle.athletes}
        subtitle={[estado.bundle.divisionName, estado.bundle.heatName].filter(Boolean).join(" · ")}
        partes={[...partes]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((p) => ({ partId: p.partId, label: p.label, structure: p.structure }))}
        heatStartEpochMs={
          estado.bundle.heatStartedAt ? new Date(estado.bundle.heatStartedAt).getTime() : null
        }
        startOffsetMs={estado.bundle.startOffsetMs}
        recordedBy={estado.bundle.judgeId ?? ""}
        onCheckStart={checkStart}
        localStart="offline"
      />
    );
  }

  return (
    <JudgeScreen
      laneId={estado.bundle.laneId}
      bib={estado.bundle.bib !== null ? String(estado.bundle.bib) : "—"}
      athlete={estado.bundle.athletes}
      subtitle={[estado.bundle.divisionName, estado.bundle.heatName].filter(Boolean).join(" · ")}
      segments={estado.bundle.segments}
      penalties={estado.bundle.penalties}
      heatStartEpochMs={
        estado.bundle.heatStartedAt ? new Date(estado.bundle.heatStartedAt).getTime() : null
      }
      startOffsetMs={estado.bundle.startOffsetMs}
      recordedBy={estado.bundle.judgeId ?? ""}
      onCheckStart={checkStart}
      localStart="offline"
    />
  );
}
