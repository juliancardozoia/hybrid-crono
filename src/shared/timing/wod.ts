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
  /**
   * Tope de tiempo de ESTE bloque de trabajo, medido desde que el bloque
   * arranca -no desde la largada del heat-. Solo tiene efecto en bloques que
   * no son `descanso`, y solo cuando la parte tiene AL MENOS un bloque
   * `descanso` (ver `reduceWodEvents`): es lo que permite "30 clean and jerk,
   * cap 8 min, descanso 1 min, thruster por tiempo" como una sola prueba, en
   * vez de partirla en dos partes con puntajes separados.
   *
   * Optativo (no `number | null` a secas) para no obligar a tocar cada
   * fixture de test que ya construye un `WodBlock` a mano: ausente se trata
   * igual que `null`.
   */
  capMs?: number | null;
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

/**
 * Un movimiento de la ronda en la que el atleta quedo -en curso, capeada, o
 * la ultima antes de terminar-, con cuanto pedia y cuanto se hizo de verdad.
 *
 * Es lo que permite decir "Pull-up completo · Push-up completo · Air Squat
 * 10 de 15" en vez de un total ambiguo como "3 rondas + 10 reps", que no
 * dice en CUAL de los tres movimientos de la ronda quedo ni si los
 * anteriores estan completos -esa ambiguedad fue justo lo que se reporto
 * como confuso, tanto para el juez como para el leaderboard.
 */
export type WodStepBreakdown = {
  name: string;
  unit: MovementUnit;
  /** 0 si el movimiento es "las que pueda" (sin objetivo). */
  target: number;
  done: number;
  completo: boolean;
};

export type WodResult = {
  laneId: string;
  status: LaneStatus;
  /** Suma de unidades completadas en todos los pasos. */
  completedReps: number;
  /**
   * Lo mismo que `completedReps`, pero separado por unidad de movimiento.
   *
   * `completedReps` suma TODO sin importar la unidad: en un chipper donde
   * todos los movimientos son `reps` eso es exactamente lo que hace falta
   * ("50 wall balls + 40 pull-ups = 90 reps"). Pero en un WOD que mezcla
   * unidades -"10 devil press" (reps, objetivo fijo) + "max cal bike"
   * (calorias, sin objetivo)- sumarlas da un numero que no significa nada:
   * 10 reps + 80 calorias no son "90" de ninguna cosa. Quien arma el score
   * (`fromTiming.ts`) usa esto para tomar SOLO la unidad que la prueba
   * puntua, en vez de la mezcla.
   */
  completedByUnit: Partial<Record<MovementUnit, number>>;
  /** Rondas enteras cerradas del bloque de trabajo. */
  completedRounds: number;
  /** Unidades hechas en la ronda en curso. */
  repsInRound: number;
  /**
   * Movimiento por movimiento de la ronda en `completedRounds + 1` (en
   * curso, capeada, o la ultima si el WOD ya cerro con algo pendiente).
   * Vacio si el bloque no tiene rondas o si todas quedaron completas sin
   * ninguna a medias (ahi "completedRounds" ya lo dice todo).
   */
  currentRoundBreakdown: WodStepBreakdown[];
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
  /**
   * Se acabo el tiempo sin terminar la tarea.
   *
   * Con bloques de descanso (ver `reduceWodEvents`), esto queda en `true`
   * para SIEMPRE en cuanto UN SOLO bloque de trabajo se cierra por su propio
   * tope -aunque el atleta haya seguido y completado todo lo que vino
   * despues-. Es la decision de producto explicita: si el bloque A no se
   * completo a tiempo, la prueba ENTERA rankea como capeada, por las reps
   * totales acumuladas (A + lo que se alcance a hacer despues), siempre
   * detras de quien completo todo. `status` puede llegar a "finished" igual
   * -significa que no queda nada mas que marcar-, y es `scoreFromWodResult`
   * quien mira `capped` primero para traducirlo a "capeado" en vez de
   * "valido".
   */
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
  /**
   * El atleta esta en un descanso OBLIGATORIO entre bloques de esta misma
   * prueba (no el descanso entre PARTES, ese lo maneja la pantalla). Mientras
   * esto sea true, el juez no tiene nada que marcar: el reductor avanza solo
   * al bloque siguiente en cuanto se cumple `descansoTerminaMs`, sin que
   * nadie tenga que decidirlo.
   */
  enDescanso: boolean;
  /** Elapsed en el que termina el descanso actual, o null si no hay ninguno activo. */
  descansoTerminaMs: number | null;
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
 * Un tramo de la prueba: o un bloque de trabajo (con el rango de pasos del
 * plan que le pertenecen y su tope propio, si tiene), o un descanso
 * obligatorio (sin pasos, con su duracion fija).
 *
 * Vive separado de `WodStep` porque un descanso no es un paso -no hay nada
 * que el juez marque- pero SI necesita representarse en la secuencia para que
 * el reductor sepa cuando bloquear el avance y durante cuanto.
 */
export type WodSegmento =
  | { kind: "trabajo"; blockId: string; capMs: number | null; stepStart: number; stepEnd: number }
  | { kind: "descanso"; blockId: string; durationMs: number | null };

/**
 * Arma en UNA sola pasada el plan de pasos Y la secuencia de segmentos.
 *
 * Las dos salen de la MISMA lista de bloques ordenados para que nunca puedan
 * divergir: si `planDelWod` indexara los pasos por su cuenta y esto los
 * recalculara aparte, un dia dejarian de coincidir y el reductor apuntaria al
 * segmento equivocado para un paso dado.
 */
function construirPlanYSegmentos(structure: WodStructure): {
  pasos: WodStep[];
  segmentos: WodSegmento[];
} {
  const pasos: WodStep[] = [];
  const segmentos: WodSegmento[] = [];

  const bloques = [...structure.blocks].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const bloque of bloques) {
    if (bloque.kind === "descanso") {
      // Un descanso no se marca: es tiempo que pasa, no trabajo que se
      // cuenta. Igual entra a `segmentos`: ahi es donde el reductor sabe que
      // tiene que bloquear el avance durante `durationMs`.
      segmentos.push({ kind: "descanso", blockId: bloque.id, durationMs: bloque.durationMs });
      continue;
    }

    const stepStart = pasos.length;
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

    segmentos.push({
      kind: "trabajo",
      blockId: bloque.id,
      capMs: bloque.capMs ?? null,
      stepStart,
      stepEnd: pasos.length,
    });
  }

  return { pasos, segmentos };
}

/**
 * Despliega la estructura en la lista ordenada de pasos que el atleta recorre.
 *
 * Un chipper es un bloque de una ronda con diez movimientos; Fran es uno de
 * tres rondas con dos. Los dos salen de aca sin ningun caso especial.
 */
export function planDelWod(structure: WodStructure): WodStep[] {
  return construirPlanYSegmentos(structure).pasos;
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
  // Con un bloque de descanso adentro, el problema cambia de forma: en vez de
  // UN tope para toda la parte, cada bloque de trabajo puede tener el suyo,
  // medido desde que ESE bloque arranca. `reduceWodEventsSimple` (sin tocar,
  // es el unico codigo probado en competencia real) sigue cubriendo TODO lo
  // demas -incluido un WOD "cap"/"libre" de un solo bloque de trabajo, que es
  // la enorme mayoria de las pruebas ya cargadas-. Este branch es
  // exclusivamente para el caso nuevo.
  //
  // OJO: no alcanza con "tiene algun bloque descanso". El patron heredado que
  // arma WodJudgeScreen para el descanso ENTRE PARTES es exactamente "un
  // bloque de trabajo + un descanso COLGANDO al final, sin nada despues" -la
  // Parte B es una estructura APARTE, no otro bloque de esta misma-. Si ese
  // patron entrara aca, el descanso nunca tendria a que bloque de trabajo
  // volver: `stepIndex >= plan.length` se cumple igual (no hay mas pasos que
  // marcar) y `status` daria "finished" AL MISMO TIEMPO que `enDescanso`
  // fuera true, dos cosas contradictorias que la pantalla ya resuelve por su
  // cuenta (el "Cerrado" con CAPEADO/TERMINO en el cuerpo, el countdown entre
  // partes en el footer). Por eso el branch nuevo exige que ALGUN descanso
  // tenga un bloque de trabajo REAL despues -sino, no hay nada que este
  // reductor tenga que resolver que el de siempre no resuelva ya.
  const { segmentos } = construirPlanYSegmentos(structure);
  const hayTrabajoDespuesDeUnDescanso = segmentos.some(
    (seg, i) => seg.kind === "descanso" && segmentos.slice(i + 1).some((s) => s.kind === "trabajo"),
  );
  const tieneDescansoIntermedio =
    (structure.scheme === "cap" || structure.scheme === "libre") && hayTrabajoDespuesDeUnDescanso;

  if (tieneDescansoIntermedio) {
    return reduceWodEventsConDescanso(laneId, events, structure, nowElapsedMs);
  }
  return reduceWodEventsSimple(laneId, events, structure, nowElapsedMs);
}

/**
 * El reductor de siempre: UN tope (cap/ventana) para toda la parte, sin
 * bloques de descanso. Es el unico codigo probado en competencia real y no se
 * toca al agregar la variante con descansos -esa vive aparte, en
 * `reduceWodEventsConDescanso`.
 */
function reduceWodEventsSimple(
  laneId: string,
  events: TimingEvent[],
  structure: WodStructure,
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
  const completedByUnit: Partial<Record<MovementUnit, number>> = {};
  function sumarPorUnidad(unit: MovementUnit, unidades: number) {
    completedByUnit[unit] = (completedByUnit[unit] ?? 0) + unidades;
  }
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
    sumarPorUnidad(paso.unit, unidades);
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
        sumarPorUnidad(paso.unit, progress);
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

  const { completedRounds, repsInRound, currentRoundBreakdown } = contarRondas(
    plan,
    stepIndex,
    progress,
    unidadesCerradas,
  );

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

  // El paso en curso (si hay uno) todavia no paso por `cerrarPaso`: su
  // progreso esta en `completedReps + progress` de siempre, y tiene que
  // sumarse a SU unidad tambien para que las dos cuentas sigan cuadrando.
  const completedByUnitFinal = { ...completedByUnit };
  if (progress > 0 && stepIndex < plan.length) {
    const unidadEnCurso = plan[stepIndex].unit;
    completedByUnitFinal[unidadEnCurso] = (completedByUnitFinal[unidadEnCurso] ?? 0) + progress;
  }

  return {
    laneId,
    status,
    completedReps: completedReps + progress,
    completedByUnit: completedByUnitFinal,
    completedRounds,
    repsInRound,
    currentRoundBreakdown,
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
    // Este reductor no tiene bloques de descanso -esa es la variante de
    // `reduceWodEventsConDescanso`-, asi que nunca esta descansando.
    enDescanso: false,
    descansoTerminaMs: null,
    anomalies,
  };
}

/**
 * El reductor de un WOD con bloques de descanso OBLIGATORIO entre bloques de
 * trabajo (ej: "30 clean and jerk, cap 8 min, descanso 1 min, thruster por
 * tiempo, sin cap"). Solo lo llama el despachador de `reduceWodEvents` cuando
 * la parte tiene al menos un bloque `descanso` y su esquema es `cap` o
 * `libre`.
 *
 * Comparte la doctrina del reductor de siempre -puro, corre igual en cliente
 * y servidor, nada se borra, las anomalias se reportan sin descartar datos-
 * pero cambia el shape del problema: en vez de UN tope para toda la parte,
 * cada bloque de trabajo tiene el suyo (o ninguno), medido desde que ESE
 * bloque arranca -nunca desde la largada del heat-, y un bloque `descanso`
 * bloquea el avance hasta que se cumple su duracion, sin que el juez decida
 * nada: se deriva del reloj, igual que el cap de siempre.
 *
 * Decision de producto (confirmada, no inferida): si UN SOLO bloque de
 * trabajo no llega a su objetivo antes de su propio tope, la prueba ENTERA
 * queda "capeada" para siempre -aunque el atleta siga y complete todo lo que
 * viene despues-, y el score final son las reps totales acumuladas en toda
 * la prueba. Por eso `capped` es una bandera que una vez prendida no se
 * apaga (`algunSegmentoCapeado`), independiente de que `status` mas adelante
 * pueda llegar a "finished" -eso solo dice "no queda nada mas que marcar";
 * es `scoreFromWodResult` quien mira `capped` primero.
 */
function reduceWodEventsConDescanso(
  laneId: string,
  events: TimingEvent[],
  structure: WodStructure,
  nowElapsedMs?: number,
): WodResult {
  const anomalies: Anomaly[] = [];
  const { pasos: plan, segmentos } = construirPlanYSegmentos(structure);
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
  const completedByUnit: Partial<Record<MovementUnit, number>> = {};
  function sumarPorUnidad(unit: MovementUnit, unidades: number) {
    completedByUnit[unit] = (completedByUnit[unit] ?? 0) + unidades;
  }
  let noRepCount = 0;
  let tiebreakMs: number | null = null;
  let ultimoCierreMs: number | null = null;
  const unidadesCerradas: number[] = [];

  // El estado del "cursor de segmento": en cual bloque estamos, desde cuando
  // corre SU reloj propio, y si ya se uso el cierre final de ESE bloque.
  let segmentIndex = 0;
  let segmentStartMs = 0;
  let cierreFinalUsadoDeSegmento = false;
  // Una vez true, queda true para siempre: es la decision de producto de
  // arriba, no se resetea aunque el atleta termine todo lo que sigue.
  let algunSegmentoCapeado = false;

  function segmentoActual() {
    return segmentos[segmentIndex];
  }

  // Compatibilidad con el patron heredado (un solo bloque de trabajo seguido
  // de un descanso, usado hasta ahora solo como el "descanso ENTRE partes"
  // que arma la pantalla del juez -ver WodJudgeScreen-): ese bloque nunca
  // declaro su propio `capMs`, confiaba en el `timeCapMs` de la PARTE. Sin
  // este fallback, cualquier estructura asi -que ya existe en produccion-
  // dejaria de capear porque el segmento no tiene tope propio.
  //
  // Solo aplica al PRIMER segmento de trabajo: es el unico caso real hoy
  // (un bloque, un descanso, nada mas), y extenderlo a bloques posteriores
  // inventaria un comportamiento sin ningun caso de uso que lo pida.
  const primerSegmentoDeTrabajo = segmentos.findIndex((s) => s.kind === "trabajo");

  function finDelSegmentoMs(): number | null {
    const seg = segmentoActual();
    if (!seg || seg.kind !== "trabajo") return null;
    const cap =
      seg.capMs ??
      (segmentIndex === primerSegmentoDeTrabajo && structure.scheme === "cap"
        ? structure.timeCapMs
        : null);
    if (cap === null) return null;
    return segmentStartMs + cap;
  }

  /**
   * Salta los descansos ya cumplidos a esta altura del reloj, en cadena -por
   * si dos bloques `descanso` quedaran seguidos, o uno de duracion 0-. Un
   * descanso no necesita ningun evento para terminar: se deriva del reloj,
   * igual que el cap.
   */
  function avanzarDescansos(hastaMs: number) {
    for (;;) {
      const seg = segmentoActual();
      if (!seg || seg.kind !== "descanso") return;
      const fin = segmentStartMs + (seg.durationMs ?? 0);
      if (hastaMs < fin) return;
      segmentIndex += 1;
      segmentStartMs = fin;
      cierreFinalUsadoDeSegmento = false;
    }
  }

  /** Cierra el segmento de trabajo actual (natural o forzado) y pasa al siguiente. */
  function cerrarSegmento(elapsedMs: number) {
    segmentIndex += 1;
    segmentStartMs = elapsedMs;
    cierreFinalUsadoDeSegmento = false;
    avanzarDescansos(elapsedMs);
  }

  /** Cierra el paso actual, avanza, y si eso termino el bloque, lo cierra. */
  function cerrarPaso(unidades: number, elapsedMs: number) {
    const paso = plan[stepIndex];
    if (!paso) return;
    completedReps += unidades;
    sumarPorUnidad(paso.unit, unidades);
    unidadesCerradas[stepIndex] = unidades;
    if (paso.isTiebreak) tiebreakMs = elapsedMs;
    ultimoCierreMs = elapsedMs;
    stepIndex += 1;
    progress = 0;

    const seg = segmentoActual();
    if (seg && seg.kind === "trabajo" && stepIndex >= seg.stepEnd) {
      cerrarSegmento(elapsedMs);
    }
  }

  const hasStart = active.some((e) => e.type === "lane_start");
  const dqEvent = active.find((e) => e.type === "dq");
  const dnfEvent = active.find((e) => e.type === "dnf");

  for (const evento of active) {
    // Antes de interpretar el evento, corremos el reloj hasta su elapsed: si
    // el descanso ya se cumplio para cuando esto llego, el evento se evalua
    // contra el bloque SIGUIENTE, no contra el descanso que ya termino.
    avanzarDescansos(evento.elapsedMs);

    const segEnDescanso = segmentoActual();
    if (segEnDescanso && segEnDescanso.kind === "descanso") {
      // Nada que marcar durante un descanso: no hay paso que cerrar, y
      // cualquier marca que llegue ahi es un error (del juez, o de la red
      // reordenando eventos), no una repeticion valida.
      if (
        evento.type === "rep" ||
        evento.type === "movement_done" ||
        evento.type === "round_done" ||
        evento.type === "no_rep" ||
        evento.type === "tiebreak"
      ) {
        anomalies.push({
          code: "marca_durante_descanso",
          message: "La marca llegó durante un descanso obligatorio: no cuenta para el resultado.",
          eventId: evento.id,
        });
      }
      continue;
    }

    const paso = plan[stepIndex];
    const tope = finDelSegmentoMs();

    if (tope !== null && evento.elapsedMs >= tope) {
      const esElCierreFinal = evento.type === "movement_done" && !cierreFinalUsadoDeSegmento;

      if (!esElCierreFinal) {
        if (
          evento.type === "rep" ||
          evento.type === "movement_done" ||
          evento.type === "round_done" ||
          evento.type === "tiebreak"
        ) {
          anomalies.push({
            code: "marca_despues_del_limite",
            message: "La marca llegó después del cap de este bloque: no cuenta para el resultado.",
            eventId: evento.id,
          });
        }
        continue;
      }

      cierreFinalUsadoDeSegmento = true;
      algunSegmentoCapeado = true;
      // Sigue al switch de abajo, que cierra el paso con la cantidad del
      // payload -y `cerrarPaso` dispara `cerrarSegmento` sola al llegar a
      // `stepEnd`-.
    }

    switch (evento.type) {
      case "rep": {
        if (!paso) {
          anomalies.push({
            code: "marca_sobrante",
            message: "Marca de repetición cuando el WOD ya estaba completo.",
            eventId: evento.id,
          });
          break;
        }
        const movimientoId = String(evento.payload.partMovementId ?? "");
        if (movimientoId && !pasoPorMovimiento.has(movimientoId)) {
          anomalies.push({
            code: "movimiento_desconocido",
            message: "La marca apunta a un movimiento que no está en esta prueba.",
            eventId: evento.id,
          });
        }
        progress += 1;
        if (!paso.maxReps && paso.target > 0 && progress >= paso.target) {
          cerrarPaso(paso.target, evento.elapsedMs);
        }
        break;
      }

      case "no_rep":
        noRepCount += 1;
        break;

      case "movement_done": {
        if (!paso) {
          anomalies.push({
            code: "marca_sobrante",
            message: "Cierre de movimiento cuando el WOD ya estaba completo.",
            eventId: evento.id,
          });
          break;
        }
        const cantidad = numeroDelPayload(evento.payload, "cantidad");
        let unidades = cantidad !== null ? cantidad : Math.max(paso.target, progress);
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
        sumarPorUnidad(paso.unit, progress);
        ultimoCierreMs = evento.elapsedMs;
        stepIndex = destino;
        progress = 0;

        const segRoundDone = segmentoActual();
        if (segRoundDone && segRoundDone.kind === "trabajo" && stepIndex >= segRoundDone.stepEnd) {
          cerrarSegmento(evento.elapsedMs);
        }
        break;
      }

      case "tiebreak":
        tiebreakMs = evento.elapsedMs;
        break;

      default:
        // lane_start, dnf, dq, note, time_cap: o ya se leyeron arriba, o no
        // afectan el conteo. `lift` no aplica a este camino (es exclusivo de
        // `sin_reloj`, que nunca llega aca).
        break;
    }
  }

  // Con el log ya recorrido, seguimos avanzando el reloj hasta "ahora": puede
  // que el ultimo evento haya caido antes de que terminara un descanso, y sin
  // esto la pantalla seguiria mostrando "descansando" con el tiempo ya
  // cumplido, o el cap de un bloque sin marcajes nunca se detectaria.
  const ultimoMarcaje = active.length > 0 ? active[active.length - 1].elapsedMs : 0;
  const elapsedDeReferencia = nowElapsedMs ?? ultimoMarcaje;
  avanzarDescansos(elapsedDeReferencia);

  const segActual = segmentoActual();
  const enDescanso = segActual?.kind === "descanso";
  const descansoTerminaMs = enDescanso ? segmentStartMs + (segActual.durationMs ?? 0) : null;

  const tope = finDelSegmentoMs();
  const seAcaboElTiempoDelSegmento = tope !== null && hasStart && elapsedDeReferencia >= tope;

  const awaitingFinalTally =
    seAcaboElTiempoDelSegmento &&
    !cierreFinalUsadoDeSegmento &&
    !!segActual &&
    segActual.kind === "trabajo" &&
    stepIndex < segActual.stepEnd;

  // Todo marcado y ningun bloque capeo en el camino: la unica forma de llegar
  // a "valido" en vez de "capeado".
  const completo = plan.length > 0 && stepIndex >= plan.length && !algunSegmentoCapeado;
  const capped = algunSegmentoCapeado;

  let status: LaneStatus;
  if (dqEvent) status = "dq";
  else if (dnfEvent) status = "dnf";
  else if (!hasStart) status = "not_started";
  // Todo marcado -capeo algun bloque o no-: no queda nada mas que el juez
  // pueda tocar. `capped` es quien decide si esto puntua como "valido" o
  // "capeado" mas adelante, en `scoreFromWodResult`.
  else if (stepIndex >= plan.length) status = "finished";
  else status = "running";

  const { completedRounds, repsInRound, currentRoundBreakdown } = contarRondas(
    plan,
    stepIndex,
    progress,
    unidadesCerradas,
  );

  const finishedMs = completo ? ultimoCierreMs : null;

  const stoppedAtMs =
    status === "dq"
      ? (dqEvent?.elapsedMs ?? null)
      : status === "dnf"
        ? (dnfEvent?.elapsedMs ?? null)
        : status === "finished"
          ? ultimoCierreMs
          : null;

  const completedByUnitFinal = { ...completedByUnit };
  if (progress > 0 && stepIndex < plan.length) {
    const unidadEnCurso = plan[stepIndex].unit;
    completedByUnitFinal[unidadEnCurso] = (completedByUnitFinal[unidadEnCurso] ?? 0) + progress;
  }

  return {
    laneId,
    status,
    completedReps: completedReps + progress,
    completedByUnit: completedByUnitFinal,
    completedRounds,
    repsInRound,
    currentRoundBreakdown,
    currentStepIndex:
      status === "running" || status === "not_started" || awaitingFinalTally
        ? Math.min(stepIndex, plan.length)
        : null,
    currentStepProgress: progress,
    finishedMs,
    tiebreakMs,
    // `sin_reloj` (carga maxima) nunca llega a este reductor: el despachador
    // solo entra aca con esquema `cap` o `libre`.
    bestLiftKg: null,
    attempts: [],
    maxAttempts: null,
    noRepCount,
    capped,
    awaitingFinalTally,
    stoppedAtMs,
    enDescanso,
    descansoTerminaMs,
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
): {
  completedRounds: number;
  repsInRound: number;
  currentRoundBreakdown: WodStepBreakdown[];
} {
  if (plan.length === 0) {
    return { completedRounds: 0, repsInRound: 0, currentRoundBreakdown: [] };
  }

  const posicion = Math.min(stepIndex, plan.length - 1);
  const bloque = plan[posicion].blockId;
  const delBloque = plan.filter((p) => p.blockId === bloque);

  const rondas = [...new Set(delBloque.map((p) => p.round))].sort((a, b) => a - b);

  // `unidadesCerradas[p.index] ?? p.target`: un paso cerrado por `rep` (que
  // solo cierra AL llegar al objetivo) o por `round_done` (que salta pasos
  // sin cerrarlos uno por uno) no tiene entrada propia, y ahi el objetivo es
  // la cuenta correcta. Un paso cerrado por `movement_done` SI tiene su
  // entrada, y esa -no el objetivo- es lo que de verdad se hizo.
  const hecho = (p: WodStep) => (p.index < stepIndex ? (unidadesCerradas[p.index] ?? p.target) : progress);

  // Una ronda cuenta como completa solo si CADA paso llego a su objetivo, no
  // solo si "avanzo": un cierre final que cierra el ultimo paso de la ronda
  // con menos de lo pedido (12 de 21 al agotarse el tiempo) hace avanzar el
  // indice igual, pero esa ronda NO se termino.
  const completedRounds = rondas.filter((ronda) =>
    delBloque
      .filter((p) => p.round === ronda)
      .every((p) => p.index < stepIndex && (p.target === 0 || hecho(p) >= p.target)),
  ).length;

  // La ronda en curso es la primera que todavia tiene algun paso sin cerrar
  // O cerrado por debajo de su objetivo -mismo criterio que `completedRounds`,
  // para que las dos cuenten lo mismo por "ronda terminada".
  const rondaEnCurso = rondas.find((ronda) =>
    delBloque
      .filter((p) => p.round === ronda)
      .some((p) => p.index >= stepIndex || (p.target > 0 && hecho(p) < p.target)),
  );

  const repsInRound =
    rondaEnCurso === undefined
      ? 0
      : delBloque
          .filter((p) => p.round === rondaEnCurso && p.index < stepIndex)
          .reduce((suma, p) => suma + hecho(p), 0) + progress;

  // Sin ronda en curso el bloque ya cerro entero: "completedRounds" ya
  // describe el resultado sin ambiguedad, y no hace falta desglosar nada.
  const currentRoundBreakdown: WodStepBreakdown[] =
    rondaEnCurso === undefined
      ? []
      : delBloque
          .filter((p) => p.round === rondaEnCurso)
          .map((p) => {
            const done = hecho(p);
            return {
              name: p.name,
              unit: p.unit,
              target: p.target,
              done,
              // "Completo" es llegar al OBJETIVO, no solo que el paso haya
              // avanzado: un cierre final con menos cantidad (12 de 21 al
              // acabarse el tiempo) SI cierra el paso -stepIndex avanza- pero
              // no llego a los 21, y mostrarlo con un check seria mentir. Un
              // movimiento "las que pueda" (target 0) nunca tiene objetivo
              // que cumplir, asi que nunca se marca completo.
              completo: p.target > 0 && done >= p.target,
            };
          });

  return { completedRounds, repsInRound, currentRoundBreakdown };
}
