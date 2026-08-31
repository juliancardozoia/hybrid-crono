/**
 * Persistencia local del juez (IndexedDB via Dexie).
 *
 * Todo marcaje se escribe ACA antes de intentar la red. Ese orden es lo que
 * garantiza que un tiempo no se pierde: cuando el tap vuelve del handler, el
 * dato ya sobrevive a que se caiga el internet, se cierre la app o se reinicie
 * el celular.
 */

import Dexie, { type Table } from "dexie";
import type { LaneBundle } from "./bundle";
import type { ClockAnchor } from "@/shared/timing/clock";
import type { TimingEvent } from "@/shared/timing/types";

export type SyncState = "pending" | "synced";

export interface OutboxEvent extends TimingEvent {
  syncState: SyncState;
  syncAttempts: number;
  lastAttemptAt: number | null;
  lastError: string | null;
}

/**
 * Latido periodico con el ultimo elapsed conocido.
 *
 * No participa del calculo del tiempo (para eso esta el ancla), pero deja un
 * piso auditable de "hasta aca sabemos que el carril iba corriendo" si el ancla
 * se corrompe o el dispositivo muere de golpe.
 */
export interface Heartbeat {
  laneId: string;
  elapsedMs: number;
  epochMs: number;
}

class JudgeDatabase extends Dexie {
  events!: Table<OutboxEvent, string>;
  anchors!: Table<ClockAnchor, string>;
  heartbeats!: Table<Heartbeat, string>;
  /** Circuito, penalizaciones y datos del carril, para poder trabajar sin red. */
  bundles!: Table<LaneBundle, string>;

  constructor() {
    super("hybrid-crono-judge");
    this.version(1).stores({
      events: "id, laneId, seq, syncState",
      anchors: "laneId",
      heartbeats: "laneId",
    });
    // Version nueva en vez de editar la anterior: un juez que ya abrio la app
    // tiene la v1 en su celular y Dexie tiene que poder migrarlo sin perder los
    // marcajes que todavia no sincronizo.
    this.version(2).stores({
      events: "id, laneId, seq, syncState",
      anchors: "laneId",
      heartbeats: "laneId",
      bundles: "laneId",
    });
  }
}

let instance: JudgeDatabase | null = null;

/**
 * Singleton perezoso: Dexie no puede instanciarse durante el render en servidor
 * de un client component, asi que la base se abre recien al primer uso real.
 */
export function getDb(): JudgeDatabase {
  if (typeof window === "undefined") {
    throw new Error("La base local del juez solo existe en el navegador.");
  }
  instance ??= new JudgeDatabase();
  return instance;
}

/**
 * Pide almacenamiento persistente para que el navegador no evicte IndexedDB si
 * el celular se queda sin espacio. Es la mitigacion del riesgo de iOS Safari.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function saveAnchor(anchor: ClockAnchor): Promise<void> {
  await getDb().anchors.put(anchor);
}

export async function loadAnchor(laneId: string): Promise<ClockAnchor | undefined> {
  return getDb().anchors.get(laneId);
}

export async function writeHeartbeat(beat: Heartbeat): Promise<void> {
  await getDb().heartbeats.put(beat);
}

export async function loadHeartbeat(laneId: string): Promise<Heartbeat | undefined> {
  return getDb().heartbeats.get(laneId);
}

/** Encola un marcaje. Devuelve recien cuando ya esta a salvo en disco. */
export async function appendEvent(event: TimingEvent): Promise<OutboxEvent> {
  const record: OutboxEvent = {
    ...event,
    syncState: "pending",
    syncAttempts: 0,
    lastAttemptAt: null,
    lastError: null,
  };
  await getDb().events.add(record);
  return record;
}

export async function loadEvents(laneId: string): Promise<OutboxEvent[]> {
  const rows = await getDb().events.where("laneId").equals(laneId).toArray();
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function loadPending(laneId: string): Promise<OutboxEvent[]> {
  const rows = await loadEvents(laneId);
  return rows.filter((e) => e.syncState === "pending");
}

export async function markSynced(ids: string[]): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.events, async () => {
    for (const id of ids) {
      await db.events.update(id, { syncState: "synced", lastError: null });
    }
  });
}

export async function markAttemptFailed(ids: string[], error: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.events, async () => {
    for (const id of ids) {
      const current = await db.events.get(id);
      if (!current) continue;
      await db.events.update(id, {
        syncAttempts: current.syncAttempts + 1,
        lastAttemptAt: Date.now(),
        lastError: error,
      });
    }
  });
}

/** Solo para el spike y para el modo entrenamiento: borra el estado local del carril. */
export async function resetLane(laneId: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.events, db.anchors, db.heartbeats, async () => {
    await db.events.where("laneId").equals(laneId).delete();
    await db.anchors.delete(laneId);
    await db.heartbeats.delete(laneId);
  });
}

/** Carriles con marcajes sin sincronizar, para poder avisarle al juez. */
export async function lanesWithPending(): Promise<string[]> {
  const filas = await getDb().events.where("syncState").equals("pending").toArray();
  return [...new Set(filas.map((e) => e.laneId))];
}
