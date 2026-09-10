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
export type LoadUnit = "kg" | "lb";

/**
 * Como registra el juez ESE movimiento.
 *
 *   tap      un toque por repeticion, y el paso se cierra solo al llegar al
 *            objetivo. El tap ES el contador del juez.
 *   hecho    un solo toque cuando el atleta termina el movimiento.
 *   numero   se escribe la cantidad y se registra.
 *
 * El reductor ya soportaba los tres comportamientos sin saber que existian:
 * `rep` cuenta de a uno, `movement_done` con `cantidad` cierra con un numero, y
 * `movement_done` sin cantidad cierra con el objetivo. Esto solo le dice a la
 * PANTALLA cual ofrecer.
 */
export type CaptureStyle = "tap" | "hecho" | "numero";

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
  /** En la que lo escribio el organizador, para mostrarselo igual al juez. */
  loadUnit: LoadUnit;
  /** Las que pueda en el tiempo restante. Nunca se completa sola. */
  maxReps: boolean;
  /** Al cerrarlo se registra el desempate, sin que el juez de un tap extra. */
  isTiebreak: boolean;
  /** Null = el derivado. Ver `estiloDelPaso`. */
  captureStyle: CaptureStyle | null;
  /**
   * Solo importa en `scheme === "sin_reloj"` (carga maxima): cuantos intentos
   * de `lift` se aceptan antes de cerrar el carril solo. Estandar de
   * halterofilia: 3, configurable por si el reglamento de la competencia pide
   * otro numero. Se ignora en cualquier otro esquema.
   */
  maxAttempts: number;
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
  /** Cuantas rondas tiene el bloque en total. Para mostrar "ronda X de N". */
  totalRounds: number;
  /** Cuantas unidades hay que hacer. 0 si es "las que pueda". */
  target: number;
  name: string;
  unit: MovementUnit;
  loadKg: number | null;
  loadUnit: LoadUnit;
  maxReps: boolean;
  isTiebreak: boolean;
  /** Ya resuelto: la pantalla no deriva nada. */
  captureStyle: CaptureStyle;
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
  /**
   * El tope de intentos de `scheme === "sin_reloj"` (ver `WodMovement.maxAttempts`),
   * o null en cualquier otro esquema. Es lo que la pantalla usa para mostrar
   * "Intento 2 de 3" y para saber cuando dejar de ofrecer VALIDO/NULO.
   */
  maxAttempts: number | null;
  noRepCount: number;
  /** Se acabo el tiempo sin terminar la tarea. */
  capped: boolean;
  /**
   * `capped` y el juez TODAVIA no reporto cuanto llevaba en el paso que quedo
   * a medias. Mientras esto sea true, la pantalla tiene que ofrecer ESE
   * cierre en vez de bloquear directo: si el atleta iba 12 de 21 cuando se
   * acabo el tiempo, esas 12 no quedan en ningun lado si nadie las escribe.
   * Se apaga solo -sin otro evento que un `movement_done`- en cuanto ese
   * cierre final se usa.
   */
  awaitingFinalTally: boolean;
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
 * Como se captura un paso: lo que dijo el organizador, o el derivado.
 *
 * VIVE ACA Y NO EN `wodStructure.ts` porque depende del OBJETIVO DE LA RONDA, y
 * eso solo esta resuelto cuando el plan se despliega.
 *
 * El orden de las reglas importa:
 *
 *   - Lo que el organizador fijo gana siempre. Es su competencia.
 *   - Una unidad que no son reps se escribe: nadie tapea 500 metros de a uno.
 *   - `max_reps` se TAPEA aunque no tenga objetivo (Fight Gone Bad, Nicole):
 *     ahi contar ES el score, y no hay un numero que el juez pueda anticipar
 *     para pedirselo al cerrar.
 *   - Cualquier otra cantidad de reps: UN TOQUE AL TERMINAR, siempre. Antes
 *     tapeaba de a uno hasta 30 y pedia un toque final recien por encima —
 *     pero tapear de a uno le saca la vista del atleta al juez una vez por
 *     rep, sea el objetivo 9 o 100, y el cierre (natural o por el cap, ver
 *     `reduceWodEvents`) siempre pide confirmar la cantidad igual. El
 *     organizador puede seguir forzando `tap` a mano para un movimiento
 *     puntual si de verdad lo quiere contado de a uno.
 */
export function estiloDelPaso(
  movimiento: WodMovement,
  /** Ya no decide nada: se conserva por si una excepcion futura vuelve a
   *  necesitar el objetivo de la ronda, sin cambiar la firma otra vez. */
  _target: number,
): CaptureStyle {
  if (movimiento.captureStyle !== null) return movimiento.captureStyle;
  if (movimiento.unit !== "reps") return "numero";
  if (movimiento.maxReps) return "tap";
  return "hecho";
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
    const totalRounds = Math.max(1, bloque.rounds);

    for (let round = 1; round <= totalRounds; round++) {
      for (const movimiento of movimientos) {
        const target = objetivoDeRonda(movimiento, round);
        pasos.push({
          index: pasos.length,
          blockId: bloque.id,
          movementId: movimiento.id,
          round,
          totalRounds,
          target,
          name: movimiento.name,
          unit: movimiento.unit,
          loadKg: movimiento.loadKg,
          loadUnit: movimiento.loadUnit,
          maxReps: movimiento.maxReps,
          isTiebreak: movimiento.isTiebreak,
          captureStyle: estiloDelPaso(movimiento, target),
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

  // Cuanto se cerro CADA paso de verdad, indexado por su posicion en `plan`.
  // `contarRondas` (el "0 rondas + N reps" que ve el juez y el score que
  // calcula el motor) necesita esto: sin esto, asumia que un paso cerrado
  // SIEMPRE llego a su objetivo completo, lo cual es cierto para un `rep`
  // (que solo cierra AL llegar al objetivo) pero FALSO para un
  // `movement_done` con una cantidad menor -un cierre final al agotarse el
  // tiempo reportando "llevaba 2 de 5", o el juez cerrando a mano con menos
  // de lo pedido-. Bug real: un WOD entero donde nadie llego ni a la mitad
  // del primer movimiento mostraba "5 reps" (el objetivo) para TODOS, sin
  // importar cuanto habian tapeado en realidad, y eso empataba a todo el
  // field en el mismo puesto.
  const unidadesCerradas: number[] = [];

  /** Cierra el paso actual y avanza. */
  function cerrarPaso(unidades: number, elapsedMs: number) {
    const paso = plan[stepIndex];
    if (!paso) return;
    completedReps += unidades;
    unidadesCerradas[stepIndex] = unidades;
    if (paso.isTiebreak) tiebreakMs = elapsedMs;
    ultimoCierreMs = elapsedMs;
    stepIndex += 1;
    progress = 0;
  }

  const hasStart = active.some((e) => e.type === "lane_start");
  const dqEvent = active.find((e) => e.type === "dq");
  const dnfEvent = active.find((e) => e.type === "dnf");

  // El limite de tiempo del esquema: el cap de un For Time, la ventana de un
  // AMRAP. Se calcula ACA (no despues del loop, donde vivia antes) porque el
  // loop lo necesita para descartar marcas tardias.
  const tope =
    structure.scheme === "ventana"
      ? structure.windowMs
      : structure.scheme === "cap"
        ? structure.timeCapMs
        : null;

  // El juez tiene derecho a UN cierre final despues de que se acabo el
  // tiempo: es el reporte de "llevaba 12 de 21" del movimiento que quedo a
  // medias, y sin el esas 12 reps no quedan en ningun lado. Pero solo una vez
  // y solo un CIERRE EXPLICITO (`movement_done`, con la cantidad que el juez
  // confirmo) — nunca un `rep` suelto, un `round_done` o mas de un cierre:
  // eso es exactamente lo que dejaba que un juez completara el WOD entero 40
  // segundos tarde ("TERMINO 12:40" con cap de 12 minutos).
  let cierreFinalUsado = false;

  for (const evento of active) {
    const paso = plan[stepIndex];

    if (tope !== null && evento.elapsedMs >= tope) {
      const esElCierreFinal = evento.type === "movement_done" && !cierreFinalUsado;

      if (!esElCierreFinal) {
        if (
          evento.type === "rep" ||
          evento.type === "movement_done" ||
          evento.type === "round_done" ||
          evento.type === "tiebreak"
        ) {
          anomalies.push({
            code: "marca_despues_del_limite",
            message:
              structure.scheme === "ventana"
                ? "La marca llegó después de agotada la ventana: no suma al resultado."
                : "La marca llegó después del cap: no cuenta para el resultado.",
            eventId: evento.id,
          });
        }
        continue;
      }

      cierreFinalUsado = true;
      // Sigue al switch de abajo, que cierra el paso normalmente con la
      // cantidad que traiga el payload.
    }

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
        let unidades = cantidad !== null ? cantidad : Math.max(paso.target, progress);
        // El juez puede escribir cualquier numero en el teclado: sin este
        // tope, tipear de mas (a proposito o por error) le da al atleta mas
        // reps -y por lo tanto mas puntos- de las que el WOD pide. `maxReps`
        // no tiene objetivo que respetar: ahi contar ES el resultado.
        if (!paso.maxReps && paso.target > 0 && unidades > paso.target) {
          anomalies.push({
            code: "cantidad_excede_objetivo",
            message: `Se registraron ${unidades} en ${paso.name} pero el objetivo era ${paso.target}: se ajusta a ${paso.target}.`,
            eventId: evento.id,
          });
          unidades = paso.target;
        }
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

  // Si el cierre final se uso, el WOD NUNCA queda "completo" aunque ese mismo
  // cierre haya alcanzado a llenar el ultimo paso: closurar el ultimo
  // movimiento CON EL TIEMPO YA VENCIDO es justamente lo que significa quedar
  // capeado, no terminar. Sin este freno, el cierre final reabriria el mismo
  // agujero que se cerro mas arriba (completar tarde contaba como "finished").
  const completo = plan.length > 0 && stepIndex >= plan.length && !cierreFinalUsado;

  // El elapsed contra el que se mide el tope: lo que diga quien evalua, o el
  // ultimo marcaje si no dijo nada. `tope` ya se calculo arriba, antes del
  // loop, porque el loop lo necesita para descartar marcas tardias.
  const ultimoMarcaje = active.length > 0 ? active[active.length - 1].elapsedMs : 0;
  const elapsedDeReferencia = nowElapsedMs ?? ultimoMarcaje;

  const seAcaboElTiempo = tope !== null && hasStart && elapsedDeReferencia >= tope;

  // En un AMRAP agotar la ventana ES terminar: el score son las rondas y reps
  // que hizo. En un For Time con cap, en cambio, no terminar es "capeado" y
  // rankea siempre detras de quien completo la tarea.
  const ventanaAgotada = structure.scheme === "ventana" && seAcaboElTiempo;
  const capped = structure.scheme === "cap" && seAcaboElTiempo && !completo;

  // Se acabo el tiempo (cap O ventana) con un paso a medias y nadie reporto
  // todavia cuanto llevaba. Independiente de `status`: en un AMRAP el status
  // ya dice "finished" apenas se agota la ventana -es la regla, un AMRAP
  // siempre termina en la bocina- pero el juez igual necesita poder escribir
  // el ultimo numero antes de que la pantalla se bloquee.
  const awaitingFinalTally =
    seAcaboElTiempo && !cierreFinalUsado && plan.length > 0 && stepIndex < plan.length;

  // Carga maxima (`sin_reloj`) no tiene plan de pasos que avanzar: un intento
  // se registra con `lift`, que nunca toca `stepIndex`, asi que `completo`
  // nunca es true para este esquema. Sin este tope, `status` se quedaba en
  // "running" para siempre -la pantalla del juez seguia ofreciendo intentos
  // sin limite, y como el motor de puntuacion solo le pone marca a un carril
  // "finished", el WOD tampoco puntuaba nunca-.
  const maxAttempts =
    structure.scheme === "sin_reloj"
      ? (structure.blocks.flatMap((b) => b.movements)[0]?.maxAttempts ?? null)
      : null;
  const intentosAgotados = maxAttempts !== null && attempts.length >= maxAttempts;

  let status: LaneStatus;
  if (dqEvent) status = "dq";
  else if (dnfEvent) status = "dnf";
  else if (!hasStart) status = "not_started";
  else if (completo || ventanaAgotada || intentosAgotados) status = "finished";
  else status = "running";

  const { completedRounds, repsInRound } = contarRondas(plan, stepIndex, progress, unidadesCerradas);

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
    currentStepIndex:
      status === "running" || status === "not_started" || awaitingFinalTally
        ? Math.min(stepIndex, plan.length)
        : null,
    currentStepProgress: progress,
    finishedMs,
    tiebreakMs,
    bestLiftKg: validos.length > 0 ? Math.max(...validos) : null,
    attempts,
    maxAttempts,
    noRepCount,
    capped,
    awaitingFinalTally,
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
  unidadesCerradas: readonly number[],
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

  // `unidadesCerradas[p.index] ?? p.target`: un paso cerrado por `rep` (que
  // solo cierra AL llegar al objetivo) o por `round_done` (que salta pasos
  // sin cerrarlos uno por uno) no tiene entrada propia, y ahi el objetivo es
  // la cuenta correcta. Un paso cerrado por `movement_done` SI tiene su
  // entrada, y esa -no el objetivo- es lo que de verdad se hizo.
  const repsInRound =
    rondaEnCurso === undefined
      ? 0
      : delBloque
          .filter((p) => p.round === rondaEnCurso && p.index < stepIndex)
          .reduce((suma, p) => suma + (unidadesCerradas[p.index] ?? p.target), 0) + progress;

  return { completedRounds, repsInRound };
}
