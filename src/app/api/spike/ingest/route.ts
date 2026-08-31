/**
 * Ingesta de marcajes — SOLO PARA EL SPIKE.
 *
 * Guarda en memoria para poder probar el contrato de idempotencia sin Supabase
 * todavia. En la fase 4 esto se reemplaza por el RPC `ingest_timing_events`,
 * que hace exactamente lo mismo con `INSERT ... ON CONFLICT (id) DO NOTHING`.
 *
 * El contrato que se esta validando aca es el que importa: el id lo genera el
 * cliente, asi que mandar el mismo lote N veces deja N=1 registros.
 */

import { NextResponse } from "next/server";
import type { TimingEvent } from "@/shared/timing/types";

interface StoredEvent extends TimingEvent {
  serverReceivedAt: number;
}

const store = new Map<string, StoredEvent>();

export async function POST(request: Request) {
  let body: { events?: TimingEvent[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const events = body.events;
  if (!Array.isArray(events)) {
    return NextResponse.json({ error: "Se esperaba un arreglo `events`" }, { status: 400 });
  }

  let inserted = 0;
  let duplicates = 0;

  for (const event of events) {
    if (typeof event?.id !== "string") {
      return NextResponse.json({ error: "Cada evento necesita un id" }, { status: 400 });
    }
    if (store.has(event.id)) {
      duplicates += 1;
      continue;
    }
    store.set(event.id, { ...event, serverReceivedAt: Date.now() });
    inserted += 1;
  }

  return NextResponse.json({ inserted, duplicates, total: store.size });
}

export async function GET(request: Request) {
  const laneId = new URL(request.url).searchParams.get("laneId");
  const all = [...store.values()].sort((a, b) => a.seq - b.seq);
  const events = laneId ? all.filter((e) => e.laneId === laneId) : all;
  return NextResponse.json({ count: events.length, events });
}

export async function DELETE() {
  const cleared = store.size;
  store.clear();
  return NextResponse.json({ cleared });
}
