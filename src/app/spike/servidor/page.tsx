"use client";

import { useCallback, useEffect, useState } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import type { TimingEvent } from "@/shared/timing/types";

interface StoredEvent extends TimingEvent {
  serverReceivedAt: number;
}

/**
 * Inspector del servidor del spike.
 *
 * Existe para poder verificar a ojo dos puntos del checklist: que los marcajes
 * hechos sin conexion llegan cuando vuelve la red, y que reenviar el mismo lote
 * no duplica nada.
 */
export default function ServerInspectorPage() {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/spike/ingest", { cache: "no-store" });
      const data = await res.json();
      setEvents(data.events ?? []);
      setStatus(null);
    } catch {
      setStatus("No se pudo consultar el servidor.");
    }
  }, []);

  // El cuerpo del efecto solo agenda: el setState ocurre dentro del callback del
  // timer. Encadenar setTimeout en vez de usar setInterval evita ademas que se
  // solapen dos consultas si el servidor tarda.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      await load();
      if (!cancelled) timer = setTimeout(poll, 2_000);
    };

    timer = setTimeout(poll, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  // Reenvia todo lo que el servidor ya tiene. Si la idempotencia funciona, el
  // conteo no se mueve y el servidor reporta solo duplicados.
  const resend = async () => {
    const res = await fetch("/api/spike/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
    });
    const data = await res.json();
    setStatus(
      `Reenviados ${events.length}: ${data.inserted} nuevos, ${data.duplicates} duplicados. Total en servidor: ${data.total}.`,
    );
    void load();
  };

  const clear = async () => {
    await fetch("/api/spike/ingest", { method: "DELETE" });
    setStatus("Servidor vaciado.");
    void load();
  };

  return (
    <main className="min-h-dvh bg-neutral-950 p-6 text-neutral-100">
      <h1 className="text-2xl font-bold">Estado del servidor (spike)</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Actualiza solo cada 2 segundos. Almacenamiento en memoria: se vacia si reinicias el
        servidor de desarrollo.
      </p>

      <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
        <strong>En Vercel este conteo no es confiable.</strong> Las funciones serverless son
        efimeras y cada request puede caer en una instancia distinta, asi que los eventos se
        pierden entre llamadas. Sirve para verificar idempotencia solo en local. Lo que si vale
        en cualquier lado es el indicador de la pantalla del juez: si dice “todo sincronizado”,
        el servidor respondio 200. En la fase 4 esto pasa a Postgres y el problema desaparece.
      </p>

      <p className="mt-6 font-mono text-5xl font-black tabular-nums">{events.length}</p>
      <p className="text-sm text-neutral-500">eventos recibidos</p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={events.length === 0}
          className="rounded-xl border border-neutral-700 px-4 py-2 text-sm disabled:opacity-40"
        >
          Reenviar todo (probar idempotencia)
        </button>
        <button
          type="button"
          onClick={() => void clear()}
          className="rounded-xl border border-red-800 px-4 py-2 text-sm text-red-400"
        >
          Vaciar servidor
        </button>
      </div>

      {status && <p className="mt-4 rounded-xl bg-neutral-900 p-3 text-sm text-lime-400">{status}</p>}

      <table className="mt-8 w-full text-left text-sm">
        <thead className="text-xs tracking-widest text-neutral-500 uppercase">
          <tr>
            <th className="py-2">#</th>
            <th>Tipo</th>
            <th>Elapsed</th>
            <th className="hidden sm:table-cell">Id del cliente</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800 font-mono">
          {events.map((e) => (
            <tr key={e.id}>
              <td className="py-2 text-neutral-500">{e.seq}</td>
              <td>{e.type}</td>
              <td className="tabular-nums">{formatElapsed(e.elapsedMs)}</td>
              <td className="hidden text-xs text-neutral-600 sm:table-cell">{e.id}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {events.length === 0 && (
        <p className="mt-6 text-neutral-600">
          Nada todavia. Abri <code className="text-neutral-400">/spike</code> y marca algunos
          parciales.
        </p>
      )}
    </main>
  );
}
