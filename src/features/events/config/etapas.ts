"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManage } from "@/features/events/lib/access";
import { detectarFieldMismatch, puntosDinamicos } from "@/shared/scoring/points";
import { huellaDelStanding } from "@/shared/scoring/hash";
import { getRankingGeneralDelEvento } from "./queries";
import type { Json } from "@/lib/supabase/types";

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}/puntuacion`);
  revalidatePath(`/panel/eventos/${eventId}/leaderboard`);
}

function traducir(error: { code?: string; message?: string }): string {
  // El mensaje del servidor gana: lo escribio la funcion para que lo lea el
  // organizador ("el corte de esta etapa ya esta confirmado...", "el
  // leaderboard cambio..."), y un texto generico aca lo tiraria a la basura.
  return error.message ?? "No se pudo confirmar el corte.";
}

/**
 * Confirma un corte por PUESTO, no por seleccion libre de equipos.
 *
 * EL PUESTO DERIVA QUIEN AVANZA, NADIE LO ELIGE A MANO. `position <= puesto`
 * avanza a todos: como los empatados COMPARTEN `position` (ver
 * `assignPhysicalPositions`), un grupo en la frontera del corte queda ENTERO
 * adentro o ENTERO afuera, sin ningun caso especial que lo permita partir.
 * La UI ya no ofrece checkboxes por equipo -- solo el numero de corte -- para
 * que no exista la posibilidad de armar una seleccion que parta un empate.
 *
 * CONSISTENCIA TEMPORAL: `huellaVista` es lo que la pantalla mostro cuando el
 * organizador la revisó. Esta accion recalcula el standing FRESCO (con
 * `getRankingGeneralDelEvento`, el MISMO motor que arma el leaderboard en
 * vivo) y compara su huella contra la que llego: si difieren, alguien cambio
 * un score entre que se revisó la pantalla y se apretó "Confirmar", y el
 * corte se rechaza en vez de congelar una seleccion que nadie llego a ver.
 *
 * AUDITORIA: el standing COMPLETO (clasificados Y eliminados, con su rank y
 * sus puntos en ese instante) se arma aca y viaja a
 * `confirmar_corte_de_etapa`, que lo congela en
 * `scoring_snapshots.cut_standings`. Es lo que permite explicar despues "por
 * que este equipo quedo afuera" sin recalcular nada retroactivamente.
 *
 * No se puede confirmar un corte sobre un field que no coincide con el
 * snapshot congelado de la etapa anterior: es la misma garantia que ya aplica
 * a `recomputeStandings` (ver `detectarFieldMismatch` en
 * src/shared/scoring/points.ts), y el corte es TAN irreversible como esa
 * escritura -- mas, de hecho, porque no se puede rehacer.
 */
export async function confirmarCorteDeEtapa(
  eventId: string,
  divisionId: string,
  stage: number,
  puestoDeCorte: number,
  huellaVista: string,
): Promise<FormState> {
  await requireManage(eventId);

  if (!Number.isFinite(puestoDeCorte) || puestoDeCorte < 1) {
    return { error: "Elegí un puesto de corte válido." };
  }

  const supabase = await createClient();

  // El pool de ESTE corte es el acumulado de la etapa ANTERIOR -- nunca el
  // de la etapa que se esta por armar.
  const etapaAnterior = stage - 1;
  const ranking = await getRankingGeneralDelEvento(eventId);
  const poolAnterior = ranking.get(`${divisionId}|${etapaAnterior}`);

  if (!poolAnterior || poolAnterior.size === 0) {
    return { error: "Todavía no hay ningún resultado cargado para poder confirmar este corte." };
  }

  // El snapshot CONGELADO de la etapa anterior, si ya lo esta, es la
  // autoridad de cuantos atletas describe esa etapa. Un field real por
  // encima de eso es exactamente lo que detectarFieldMismatch existe para
  // frenar: cortar sobre esa curva desfasada seria congelar el error para
  // siempre.
  const { data: snapshotAnterior } = await supabase
    .from("scoring_snapshots")
    .select("field_size, locked_at")
    .eq("division_id", divisionId)
    .eq("stage", etapaAnterior)
    .maybeSingle();

  if (snapshotAnterior?.locked_at) {
    const mismatch = detectarFieldMismatch({
      divisionId,
      stage: etapaAnterior,
      snapshotFieldSize: snapshotAnterior.field_size,
      actualFieldSize: poolAnterior.size,
    });
    if (mismatch) {
      return {
        error: `La tabla de la etapa ${etapaAnterior} se congeló con ${mismatch.snapshotFieldSize} atletas y hoy hay ${mismatch.actualFieldSize}: no se puede confirmar este corte hasta resolverlo. Revisá el snapshot de esa etapa en Puntuación.`,
      };
    }
  }

  const entradas = [...poolAnterior.entries()].map(([teamId, r]) => ({
    teamId,
    position: r.position,
    totalPoints: r.totalPoints,
  }));

  const huellaActual = huellaDelStanding(entradas);
  if (huellaActual !== huellaVista) {
    return {
      error:
        "El leaderboard cambió desde que revisaste esta pantalla. Volvé a mirarlo y confirmá de nuevo antes de cortar.",
    };
  }

  const cutStandings = [...poolAnterior.entries()].map(([teamId, r]) => ({
    team_id: teamId,
    rank: r.position,
    points: r.totalPoints,
    tied_with: r.tiedWith,
    advanced: r.position <= puestoDeCorte,
  }));

  const cantidadQueAvanza = cutStandings.filter((c) => c.advanced).length;
  if (cantidadQueAvanza === 0) {
    return { error: "Ningún equipo queda clasificado con ese puesto de corte." };
  }

  const { error } = await supabase.rpc("confirmar_corte_de_etapa", {
    p_division_id: divisionId,
    p_stage: stage,
    p_cut_position: puestoDeCorte,
    p_cut_standings: cutStandings as unknown as Json,
    p_cut_hash: huellaActual,
    p_scoring_points: puntosDinamicos(cantidadQueAvanza),
  });

  if (error) return { error: traducir(error) };
  refrescar(eventId);
  return OK;
}
