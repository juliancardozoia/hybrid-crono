/**
 * Reductor de WODs: log de marcajes -> estado del atleta en la prueba.
 *
 * Es el hermano de `reduceLaneEvents`, no su reemplazo. Un circuito y un WOD se
 * cronometran con la misma infraestructura —el mismo log append-only, el mismo
 * ancla del reloj, el mismo outbox— pero se reducen distinto: en un circuito el
 * n-esimo marcaje cierra el n-esimo segmento; en un WOD hay repeticiones,
 * rondas, no-reps e intentos de levantamiento.
 *
 * Vive al lado y no adentro de reducer.ts a proposito: aquel es el unico codigo
 * probado en competencia real y no se toca.
 *
 * Igual que su hermano: es PURO, corre identico en el celular del juez y en el
 * servidor, nada se borra (solo se supersede o se anula), y las anomalias se
 * reportan sin descartar datos nunca.
 */

import type { Anomaly, LaneStatus, TimingEvent } from "./types";

export type MovementUnit = "reps" | "metros" | "calorias" | "segundos" | "kg";
export type BlockKind = "buy_in" | "trabajo" | "descanso" | "cash_out";
export type WodScheme = "libre" | "cap" | "ventana" | "intervalos" | "sin_reloj";

export type WodMovement = {
  /** id de part_movements. */
  id: string;
  orderIndex: number;
  name: string;
  unit: MovementUnit;
  /**
   * Un valor por ronda. Longitud 1 = igual en todas.
   * {21,15,9} es Fran; {1,2,3,...} es un Death By.
   */
  targetPerRound: number[];
  loadKg: number | null;
  /** Las que pueda en el tiempo restante. Nunca se completa sola. */
  maxReps: boolean;
  /** Al cerrarlo se registra el desempate, sin que el juez de un tap extra. */
  isTiebreak: boolean;
};

export type WodBlock = {
  id: string;
  orderIndex: number;
  kind: BlockKind;
  /** Las rondas del bloque. */
  rounds: number;
  durationMs: number | null;
  restMs: number | null;
  movements: WodMovement[];
};

export type WodStructure = {
  scheme: WodScheme;
  timeCapMs: number | null;
  windowMs: number | null;
  intervalMs: number | null;
  blocks: WodBlock[];
};

/**
 * Un paso del WOD ya desplegado: un movimiento en una ronda concreta.
 *
 * Desplegar los bloques por sus rondas es lo que hace que la pantalla del juez
 * no tenga que razonar sobre esquemas de repeticiones: le pide el paso actual y
 * pinta su objetivo.
 */
export type WodStep = {
  index: number;
  blockId: string;
  movementId: string;
  /** Ronda dentro del bloque, empezando en 1. */
  round: number;
  /** Cuantas unidades hay que hacer. 0 si es "las que pueda". */
  target: number;
  name: string;
  unit: MovementUnit;
  loadKg: number | null;
  maxReps: boolean;
  isTiebreak: boolean;
};

export type LiftAttempt = {
  loadKg: number;
  valido: boolean;
  elapsedMs: number;
};

export type WodResult = {
  laneId: string;
  status: LaneStatus;
  /** Suma de unidades completadas en todos los pasos. */
  completedReps: number;
  /** Rondas enteras cerradas del bloque de trabajo. */
  completedRounds: number;
  /** Unidades hechas en la ronda en curso. */
  repsInRound: number;
  /** Paso que le toca marcar al juez, o null si ya termino. */
  currentStepIndex: number | null;
  /** Cuanto lleva hecho del paso actual. */
  currentStepProgress: number;
  /** Elapsed al cerrar el ultimo paso. Solo si completo todo el WOD. */
  finishedMs: number | null;
  /** Elapsed al cerrar el movimiento marcado como desempate. */
  tiebreakMs: number | null;
  bestLiftKg: number | null;
  attempts: LiftAttempt[];
  noRepCount: number;
  /** Se acabo el tiempo sin terminar la tarea. */
  capped: boolean;
  /** Elapsed en el que el carril dejo de correr. Congela el reloj en pantalla. */
  stoppedAtMs: number | null;
  anomalies: Anomaly[];
};

/** El objetivo de un movimiento en una ronda dada. */
function objetivoDeRonda(movimiento: WodMovement, round: number): number {
  if (movimiento.maxReps) return 0;
  const valores = movimiento.targetPerRound;
  if (valores.length === 0) return 0;
  // Fuera del arreglo se repite el ultimo: {10} con tres rondas son tres de 10.
  return valores[Math.min(round, valores.length) - 1] ?? 0;
}

/**
 * Despliega la estructura en la lista ordenada de pasos que el atleta recorre.
 *
 * Un chipper es un bloque de una ronda con diez movimientos; Fran es uno de
 * tres rondas con dos. Los dos salen de aca sin ningun caso especial.
 */
export function planDelWod(structure: WodStructure): WodStep[] {
  const pasos: WodStep[] = [];

  const bloques = [...structure.blocks].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const bloque of bloques) {
    // Un descanso no se marca: es tiempo que pasa, no trabajo que se cuenta.
    if (bloque.kind === "descanso") continue;

    const movimientos = [...bloque.movements].sort((a, b) => a.orderIndex - b.orderIndex);

    for (let round = 1; round <= Math.max(1, bloque.rounds); round++) {
      for (const movimiento of movimientos) {
        pasos.push({
          index: pasos.length,
          blockId: bloque.id,
          movementId: movimiento.id,
          round,
          target: objetivoDeRonda(movimiento, round),
          name: movimiento.name,
          unit: movimiento.unit,
          loadKg: movimiento.loadKg,
          maxReps: movimiento.maxReps,
          isTiebreak: movimiento.isTiebreak,
        });
      }
    }
  }

  return pasos;
}

function numeroDelPayload(payload: Record<string, unknown>, clave: string): number | null {
  const valor = payload[clave];
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "" && Number.isFinite(Number(valor))) {
    return Number(valor);
  }
  return null;
}

export function reduceWodEvents(
  laneId: string,
  events: TimingEvent[],
  structure: WodStructure,
  /**
   * Elapsed en el momento de evaluar. Lo pasa la pantalla del juez (su reloj
   * vivo) y el recalculo del servidor (ahora menos la largada del heat).
   *
   * Existe porque el cap NO lo decide un evento: si la app quedo en segundo
   * plano cuando sono el cap, nadie lo emite. Derivarlo comparando elapsed
   * contra el tope es la misma doctrina que el ancla del reloj — se deriva, no
   * se acumula.
   */
  nowElapsedMs?: number,
): WodResult {
  const anomalies: Anomaly[] = [];
  const plan = planDelWod(structure);
  const pasoPorMovimiento = new Set(plan.map((p) => p.movementId));

  const mine = events.filter((e) => e.laneId === laneId);
  const byId = new Map(mine.map((e) => [e.id, e]));

  const superseded = new Set<string>();
  for (const e of mine) {
    if (!e.supersedesId) continue;
    if (!byId.has(e.supersedesId)) {
      anomalies.push({
        code: "orphan_undo",
        message: `El evento ${e.id} anula a ${e.supersedesId}, que no existe en este log.`,
        eventId: e.id,
      });
      continue;
    }
    superseded.add(e.supersedesId);
  }

  const active = mine
    .filter((e) => !e.voided && !superseded.has(e.id) && e.type !== "undo")
    .sort((a, b) => a.elapsedMs - b.elapsedMs || a.seq - b.seq);

  let stepIndex = 0;
  let progress = 0;
  let completedReps = 0;
  let noRepCount = 0;
  let tiebreakMs: number | null = null;
  let ultimoCierreMs: number | null = null;
  const attempts: LiftAttempt[] = [];

  /** Cierra el paso actual y avanza. */
  function cerrarPaso(unidades: number, elapsedMs: number) {
    const paso = plan[stepIndex];
    if (!paso) return;
    completedReps += unidades;
    if (paso.isTiebreak) tiebreakMs = elapsedMs;
    ultimoCierreMs = elapsedMs;
    stepIndex += 1;
    progress = 0;
  }

  const hasStart = active.some((e) => e.type === "lane_start");
  const dqEvent = active.find((e) => e.type === "dq");
  const dnfEvent = active.find((e) => e.type === "dnf");

  for (const evento of active) {
    const paso = plan[stepIndex];

    switch (evento.type) {
      case "rep": {
        if (!paso) {
          anomalies.push({
            code: "marca_sobrante",
            message: `Marca de repetición cuando el WOD ya estaba completo.`,
            eventId: evento.id,
          });
          break;
        }
        const movimientoId = String(evento.payload.partMovementId ?? "");
        if (movimientoId && !pasoPorMovimiento.has(movimientoId)) {
          anomalies.push({
            code: "movimiento_desconocido",
            message: `La marca apunta a un movimiento que no está en esta prueba.`,
            eventId: evento.id,
          });
        }
        progress += 1;
        // Un movimiento "las que pueda" no se cierra solo: lo cierra el juez o
        // el reloj del intervalo.
        if (!paso.maxReps && paso.target > 0 && progress >= paso.target) {
          cerrarPaso(paso.target, evento.elapsedMs);
        }
        break;
      }

      case "no_rep":
        // Queda registrada y no suma. Es lo que hace auditable un reclamo.
        noRepCount += 1;
        break;

      case "movement_done": {
        if (!paso) {
          anomalies.push({
            code: "marca_sobrante",
            message: `Cierre de movimiento cuando el WOD ya estaba completo.`,
            eventId: evento.id,
          });
          break;
        }
        const cantidad = numeroDelPayload(evento.payload, "cantidad");
        const unidades = cantidad !== null ? cantidad : Math.max(paso.target, progress);
        cerrarPaso(unidades, evento.elapsedMs);
        break;
      }

      case "round_done": {
        // Salta al primer paso de la ronda siguiente. Lo que quedo sin marcar
        // en esta ronda no se cuenta: el juez decidio pasar de largo.
        if (!paso) break;
        const rondaActual = paso.round;
        const bloqueActual = paso.blockId;
        let destino = stepIndex;
        while (
          destino < plan.length &&
          plan[destino].blockId === bloqueActual &&
          plan[destino].round === rondaActual
        ) {
          destino += 1;
        }
        completedReps += progress;
        ultimoCierreMs = evento.elapsedMs;
        stepIndex = destino;
        progress = 0;
        break;
      }

      case "lift": {
        const loadKg = numeroDelPayload(evento.payload, "loadKg");
        if (loadKg === null) break;
        attempts.push({
          loadKg,
          valido: evento.payload.valido !== false,
          elapsedMs: evento.elapsedMs,
        });
        break;
      }

      case "tiebreak":
        tiebreakMs = evento.elapsedMs;
        break;

      default:
        // lane_start, dnf, dq, note, time_cap y los tipos del circuito se
        // ignoran: o ya se leyeron arriba, o no afectan el conteo.
        break;
    }
  }

  const completo = plan.length > 0 && stepIndex >= plan.length;

  // El elapsed contra el que se mide el tope: lo que diga quien evalua, o el
  // ultimo marcaje si no dijo nada.
  const ultimoMarcaje = active.length > 0 ? active[active.length - 1].elapsedMs : 0;
  const elapsedDeReferencia = nowElapsedMs ?? ultimoMarcaje;

  const tope =
    structure.scheme === "ventana"
      ? structure.windowMs
      : structure.scheme === "cap"
        ? structure.timeCapMs
        : null;

  const seAcaboElTiempo = tope !== null && hasStart && elapsedDeReferencia >= tope;

  // En un AMRAP agotar la ventana ES terminar: el score son las rondas y reps
  // que hizo. En un For Time con cap, en cambio, no terminar es "capeado" y
  // rankea siempre detras de quien completo la tarea.
  const ventanaAgotada = structure.scheme === "ventana" && seAcaboElTiempo;
  const capped = structure.scheme === "cap" && seAcaboElTiempo && !completo;

  let status: LaneStatus;
  if (dqEvent) status = "dq";
  else if (dnfEvent) status = "dnf";
  else if (!hasStart) status = "not_started";
  else if (completo || ventanaAgotada) status = "finished";
  else status = "running";

  const { completedRounds, repsInRound } = contarRondas(plan, stepIndex, progress);

  const finishedMs = completo ? ultimoCierreMs : null;

  const stoppedAtMs =
    status === "dq"
      ? (dqEvent?.elapsedMs ?? null)
      : status === "dnf"
        ? (dnfEvent?.elapsedMs ?? null)
        : completo
          ? finishedMs
          : ventanaAgotada || capped
            ? tope
            : null;

  const validos = attempts.filter((a) => a.valido).map((a) => a.loadKg);

  return {
    laneId,
    status,
    completedReps: completedReps + progress,
    completedRounds,
    repsInRound,
    currentStepIndex: status === "running" || status === "not_started" ? Math.min(stepIndex, plan.length) : null,
    currentStepProgress: progress,
    finishedMs,
    tiebreakMs,
    bestLiftKg: validos.length > 0 ? Math.max(...validos) : null,
    attempts,
    noRepCount,
    capped,
    stoppedAtMs,
    anomalies,
  };
}

/**
 * Rondas enteras cerradas y unidades hechas en la que esta en curso.
 *
 * Es lo que se muestra en un AMRAP: "ronda 4 · 63 reps". Se cuenta sobre el
 * bloque al que pertenece el paso actual, porque un buy-in no es una ronda.
 */
function contarRondas(
  plan: WodStep[],
  stepIndex: number,
  progress: number,
): { completedRounds: number; repsInRound: number } {
  if (plan.length === 0) return { completedRounds: 0, repsInRound: 0 };

  const posicion = Math.min(stepIndex, plan.length - 1);
  const bloque = plan[posicion].blockId;
  const delBloque = plan.filter((p) => p.blockId === bloque);

  const rondas = [...new Set(delBloque.map((p) => p.round))].sort((a, b) => a - b);

  const completedRounds = rondas.filter((ronda) =>
    delBloque.filter((p) => p.round === ronda).every((p) => p.index < stepIndex),
  ).length;

  // La ronda en curso es la primera que todavia tiene algun paso sin cerrar.
  const rondaEnCurso = rondas.find((ronda) =>
    delBloque.filter((p) => p.round === ronda).some((p) => p.index >= stepIndex),
  );

  const repsInRound =
    rondaEnCurso === undefined
      ? 0
      : delBloque
          .filter((p) => p.round === rondaEnCurso && p.index < stepIndex)
          .reduce((suma, p) => suma + p.target, 0) + progress;

  return { completedRounds, repsInRound };
}
