"use client";

import { useEffect, useState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import type { SegmentRow } from "@/lib/supabase/types";

/**
 * Simulacion, TODO VISUAL, de la pantalla del juez para un circuito.
 *
 * Hermana de `VistaPreviaInteractivaWod`: mismo espiritu, mismo estado 100%
 * local sin tocar IndexedDB ni la red, pero para la otra pantalla del juez —
 * la del circuito (`JudgeScreen`), un boton "SIGUIENTE" por segmento en vez de
 * contar repeticiones. Deja ver ANTES del dia de la competencia si el orden de
 * los segmentos es el que el organizador tenia en mente.
 */
const PENALIZACIONES_DE_EJEMPLO = [
  { label: "Estacion incompleta", texto: "+10s" },
  { label: "Salida en falso", texto: "+5s" },
  { label: "Descalificación", texto: "DQ" },
];

const TIPOS: Record<string, string> = {
  run: "Corrida",
  station: "Estación",
  transition: "Transición",
};

export function VistaPreviaInteractivaCircuito({ segments }: { segments: SegmentRow[] }) {
  const ordenados = [...segments].sort((a, b) => a.order_index - b.order_index);

  const [marcados, setMarcados] = useState(0);
  const [terminado, setTerminado] = useState<"ok" | "dnf" | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [inicioMs, setInicioMs] = useState<number | null>(null);
  const [ahoraMs, setAhoraMs] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!corriendo) return;
    const timer = setInterval(() => setAhoraMs(Date.now()), 100);
    return () => clearInterval(timer);
  }, [corriendo]);

  if (ordenados.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-neutral-800 p-4 text-center text-sm text-neutral-600">
        Sin segmentos todavía. Agrega alguno para poder simular la pantalla
        del juez.
      </p>
    );
  }

  const siguiente = ordenados[marcados] ?? null;
  const elapsedMs = inicioMs !== null && ahoraMs !== null ? ahoraMs - inicioMs : 0;

  function empezar() {
    const ahora = Date.now();
    setInicioMs(ahora);
    setAhoraMs(ahora);
    setCorriendo(true);
  }

  function reiniciar() {
    setMarcados(0);
    setTerminado(null);
    setCorriendo(false);
    setInicioMs(null);
    setAhoraMs(null);
    setSheetOpen(false);
  }

  function marcar() {
    const proximo = marcados + 1;
    setMarcados(proximo);
    if (proximo >= ordenados.length) {
      setTerminado("ok");
      setCorriendo(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-neutral-100">
      <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs font-semibold tracking-wide text-amber-300 uppercase">
        Vista previa — nada se guarda, no hay conexión
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div className="text-center">
          <p className="font-mono text-4xl font-bold tabular-nums">
            {corriendo || terminado ? formatElapsed(elapsedMs, { centis: false }) : "00:00"}
          </p>
          <p className="text-xs text-neutral-500">
            {terminado ? "detenido" : corriendo ? "transcurrido (simulado)" : "sin largar"}
          </p>
          <p className="mt-1 font-mono text-sm text-neutral-500">
            {Math.min(marcados, ordenados.length)}/{ordenados.length} parciales
          </p>
        </div>

        {!corriendo && !terminado && (
          <button
            type="button"
            onClick={empezar}
            className="rounded-2xl border border-lime-400/50 bg-lime-400/10 py-3 text-sm font-bold text-lime-300"
          >
            SIMULAR LARGADA
          </button>
        )}

        {terminado && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-3xl border border-neutral-800">
            <p className="text-2xl font-black">
              {terminado === "dnf" ? "NO TERMINÓ (simulado)" : "TERMINÓ (simulado)"}
            </p>
            <p className="font-mono text-lg text-neutral-400">{formatElapsed(elapsedMs)}</p>
          </div>
        )}

        {corriendo && siguiente && (
          <button
            type="button"
            onClick={marcar}
            className="flex h-40 w-full flex-col items-center justify-center gap-1 rounded-2xl bg-lime-400 px-4 text-center text-lime-950 active:bg-lime-300"
          >
            <span className="text-sm font-medium opacity-70">SIGUIENTE ▸</span>
            <span className="text-2xl leading-tight font-black text-balance">{siguiente.name}</span>
            <span className="mt-1 text-xs opacity-60">
              {TIPOS[siguiente.kind] ?? siguiente.kind} · {marcados + 1} de {ordenados.length}
            </span>
          </button>
        )}

        {(corriendo || terminado) && (
          <div className="flex gap-2">
            {corriendo && (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="flex-1 rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 text-sm font-semibold text-amber-300"
              >
                PENALIZAR
              </button>
            )}
            {corriendo && (
              <button
                type="button"
                onClick={() => {
                  setTerminado("dnf");
                  setCorriendo(false);
                }}
                className="flex-1 rounded-xl border border-neutral-800 py-2.5 text-sm text-neutral-500"
              >
                Marcar DNF
              </button>
            )}
            {terminado && (
              <button
                type="button"
                onClick={reiniciar}
                className="flex-1 rounded-xl border border-neutral-700 py-2.5 text-sm text-neutral-300"
              >
                Simular de nuevo
              </button>
            )}
          </div>
        )}
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/70"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="rounded-t-3xl border-t border-neutral-700 bg-neutral-900 p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="mb-1 text-sm font-bold">Aplicar penalización (ejemplo)</h4>
            <p className="mb-4 text-xs text-neutral-500">
              Las penalizaciones reales de tu evento se cargan en “Penalizaciones”.
            </p>
            <ul className="space-y-2">
              {PENALIZACIONES_DE_EJEMPLO.map((p) => (
                <li key={p.label}>
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="flex w-full items-center justify-between rounded-2xl border border-neutral-700 px-4 py-3 text-left text-sm"
                  >
                    <span className="font-semibold">{p.label}</span>
                    <span className="font-mono text-amber-400">{p.texto}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="mt-4 w-full py-3 text-center text-sm text-neutral-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
