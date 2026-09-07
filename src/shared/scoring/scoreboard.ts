/**
 * De documento crudo a tabla general, listo para pintar.
 *
 * Es la entrada que consumen las pantallas. La base devuelve filas sin rankear
 * —ni posiciones, ni puntos, ni desempates— y todo eso se calcula aca, con las
 * mismas funciones puras que usa el recalculo del servidor. Por eso el
 * leaderboard en vivo y el oficial no pueden diferir: no hay dos
 * implementaciones que puedan divergir, hay una.
 */

import { computeOverall, resolverTiebreaksDeOtraPrueba } from "./overall";
import { escalarTabla, tablaDeCategoria } from "./points";
import type {
  OverallEntry,
  PartSpec,
  RawScore,
  ScoreDir,
  ScoreStatus,
  ScoreUnit,
  ScoringTable,
} from "./types";

export type ScoreboardDivision = {
  id: string;
  name: string;
};

export type ScoreboardPart = {
  id: string;
  workoutId: string;
  workoutName: string;
  label: string;
  orderIndex: number;
  /**
   * A que etapa pertenece el WOD de esta parte ("Stage 1 con 40 -> cut ->
   * Stage 2 con 20"). La etapa es del WORKOUT, no de la parte: sus partes A/B
   * corren siempre juntas.
   */
  stage: number;
  scoreUnit: ScoreUnit;
  scoreDir: ScoreDir;
  capUnit: ScoreUnit | null;
  /** Cuanto vale ganar ESTA prueba. 100 salvo que el organizador la pese distinto. */
  maxPoints: number;
  tiebreakUnit: ScoreUnit | null;
  tiebreakDir: ScoreDir | null;
  /** Si el desempate viene de otra parte, su id. Null en el resto de los casos. */
  tiebreakPartId: string | null;
};

/** La curva CONGELADA de una (categoria, etapa). Normalizada a 100. */
export type ScoreboardSnapshot = {
  divisionId: string;
  stage: number;
  points: number[];
  locked: boolean;
};

/** Quien avanzo a una etapa. Decision explicita del organizador, nunca automatica. */
export type ScoreboardAdvancement = {
  divisionId: string;
  stage: number;
  teamId: string;
};

export type ScoreboardTeam = {
  id: string;
  divisionId: string;
  bib: number;
  name: string | null;
  athletes: string | null;
};

export type ScoreboardScore = {
  partId: string;
  teamId: string;
  status: ScoreStatus;
  value: number | null;
  reps: number | null;
  capValue: number | null;
  tiebreak: number | null;
};

/** Que categoria corre que prueba. */
export type ScoreboardAssignment = {
  partId: string;
  divisionId: string;
};

/** Mapea uno a uno lo que devuelve public_scoreboard(). */
export type ScoreboardInput = {
  version: number;
  detalle: boolean;
  event: {
    name: string;
    venue: string | null;
    status: string;
    /** Decide si la categoria reparte puntos o se gana por tiempo. */
    format: string;
    official: boolean;
  };
  divisions: ScoreboardDivision[];
  /** Una fila por (categoria, etapa) que ya tenga tabla generada o congelada. */
  snapshots: ScoreboardSnapshot[];
  /** Quien avanzo a cada etapa, por categoria. */
  stageAdvancements: ScoreboardAdvancement[];
  parts: ScoreboardPart[];
  assignments: ScoreboardAssignment[];
  teams: ScoreboardTeam[];
  scores: ScoreboardScore[];
};

export type ScoreboardDivisionResult = {
  division: ScoreboardDivision;
  /** La etapa que muestra esta tabla ("Stage 1 con 40 -> cut -> Stage 2 con 20"). */
  stage: number;
  parts: ScoreboardPart[];
  entries: Array<OverallEntry & { team: ScoreboardTeam }>;
};

export function buildScoreboard(input: ScoreboardInput): ScoreboardDivisionResult[] {
  const partePorId = new Map(input.parts.map((p) => [p.id, p]));

  const crudosSinResolver: RawScore[] = input.scores.map((s) => ({
    partId: s.partId,
    teamId: s.teamId,
    status: s.status,
    // La base devuelve numeric, que en JSON puede llegar como texto segun el
    // driver. Se normaliza aca y no en cada consumidor.
    value: aNumero(s.value),
    reps: aNumero(s.reps),
    capValue: aNumero(s.capValue),
    tiebreak: aNumero(s.tiebreak),
  }));

  // Todas las partes del evento, no solo las de una categoria: el desempate
  // "de otra prueba" se resuelve UNA vez, antes de entrar al bucle por
  // division, porque necesita ver el conjunto completo de scores.
  const todasLasPartes: PartSpec[] = input.parts.map((p) => ({
    id: p.id,
    orderIndex: p.orderIndex,
    scoreUnit: p.scoreUnit,
    scoreDir: p.scoreDir,
    capUnit: p.capUnit,
    tiebreakUnit: p.tiebreakUnit,
    tiebreakDir: p.tiebreakDir,
    tiebreakPartId: p.tiebreakPartId,
  }));
  const crudos = resolverTiebreaksDeOtraPrueba(todasLasPartes, crudosSinResolver);
  const specPorId = new Map(todasLasPartes.map((p) => [p.id, p]));

  // Quien avanzo a cada (categoria, etapa). La etapa 1 no tiene filas aca a
  // proposito -- todo equipo activo participa -- asi que se resuelve aparte.
  const avanzanPorDivisionYEtapa = new Map<string, Set<string>>();
  for (const a of input.stageAdvancements ?? []) {
    const clave = `${a.divisionId}|${a.stage}`;
    const set = avanzanPorDivisionYEtapa.get(clave) ?? new Set<string>();
    set.add(a.teamId);
    avanzanPorDivisionYEtapa.set(clave, set);
  }

  const snapshotPorDivisionYEtapa = new Map(
    (input.snapshots ?? []).map((s) => [`${s.divisionId}|${s.stage}`, s]),
  );

  const resultados: ScoreboardDivisionResult[] = [];

  for (const division of input.divisions) {
    const equipos = input.teams.filter((t) => t.divisionId === division.id);
    const equipoPorId = new Map(equipos.map((t) => [t.id, t]));

    const asignacionesDeLaDivision = input.assignments.filter(
      (a) => a.divisionId === division.id,
    );

    // Las partes de la categoria, agrupadas por la etapa de SU workout.
    const partesPorEtapa = new Map<number, ScoreboardPart[]>();
    for (const a of asignacionesDeLaDivision) {
      const parte = partePorId.get(a.partId);
      if (!parte) continue;
      const lista = partesPorEtapa.get(parte.stage) ?? [];
      lista.push(parte);
      partesPorEtapa.set(parte.stage, lista);
    }

    // La etapa 1 se muestra SIEMPRE, aunque todavia no haya ninguna prueba
    // cargada: es la lista de largada que ve el publico antes de competir.
    const etapas = new Set(partesPorEtapa.keys());
    etapas.add(1);

    for (const stage of [...etapas].sort((a, b) => a - b)) {
      const partes = [...(partesPorEtapa.get(stage) ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );

      // Quien compite en esta etapa: en la 1, toda la categoria. De ahi en
      // mas, SOLO quien avanzo -- una decision explicita del organizador, que
      // puede no haberse tomado todavia.
      const equipoIds =
        stage === 1
          ? equipos.map((t) => t.id)
          : [...(avanzanPorDivisionYEtapa.get(`${division.id}|${stage}`) ?? [])];

      if (equipoIds.length === 0) continue;

      // La curva de la etapa: la congelada si ya se genero, o una al vuelo
      // con el field de hoy. Una carrera hibrida no reparte puntos.
      const snapshot = snapshotPorDivisionYEtapa.get(`${division.id}|${stage}`);
      const tabla: ScoringTable = tablaDeCategoria({
        formato: input.event.format,
        snapshot: snapshot ? snapshot.points : null,
        fieldSize: equipoIds.length,
      });

      // El peso de cada prueba escala esa misma curva. Antes esto se
      // expresaba asignandole otra TABLA a la parte; un multiplicador dice lo
      // mismo sin poder desincronizarse de la curva de la categoria.
      const pesoPorParte = new Map(partes.map((p) => [p.id, p.maxPoints]));

      const specs: PartSpec[] = partes.map((p) => specPorId.get(p.id)).filter((s): s is PartSpec => Boolean(s));

      const general = computeOverall({
        parts: specs,
        tableFor: (part) => escalarTabla(tabla, pesoPorParte.get(part.id) ?? 100),
        teamIds: equipoIds,
        scores: crudos,
      });

      const entries = general.flatMap((entrada) => {
        const team = equipoPorId.get(entrada.teamId);
        return team ? [{ ...entrada, team }] : [];
      });

      if (entries.length === 0) continue;

      resultados.push({ division, stage, parts: partes, entries });
    }
  }

  return resultados.sort(
    (a, b) => a.division.name.localeCompare(b.division.name) || a.stage - b.stage,
  );
}

function aNumero(valor: number | string | null): number | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}
