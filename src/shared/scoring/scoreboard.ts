/**
 * De documento crudo a tabla general, listo para pintar.
 *
 * Es la entrada que consumen las pantallas. La base devuelve filas sin rankear
 * —ni posiciones, ni puntos, ni desempates— y todo eso se calcula aca, con las
 * mismas funciones puras que usa el recalculo del servidor. Por eso el
 * leaderboard en vivo y el oficial no pueden diferir: no hay dos
 * implementaciones que puedan divergir, hay una.
 */

import { compararEntradasGenerales, computeOverall, resolverTiebreaksDeOtraPrueba } from "./overall";
import { assignPhysicalPositions } from "./place";
import { escalarTabla, redondear, tablaDeCategoria } from "./points";
import type {
  OverallEntry,
  PartPlacement,
  PartSpec,
  RawScore,
  RoundBreakdownStep,
  ScoreDir,
  ScoreStatus,
  ScoreUnit,
  ScoringTable,
  TiePointPolicy,
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
  /**
   * `circuito` o el esquema del WOD (`cap`, `ventana`, etc). Solo se usa para
   * decidir si la tabla general es redundante con el leaderboard de tiempos
   * (`getLeaderboard`/`results`) -- ver TablaGeneral.tsx -- que solo muestra
   * carriles de circuito.
   */
  timeScheme: string;
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
  /** Como reparte esta (categoria, etapa) sus empates. Congelada con la tabla. */
  tiePointPolicy: TiePointPolicy;
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
  /**
   * Pais (ISO de dos letras, o null) de cada integrante, EN EL MISMO ORDEN
   * que `athletes` (por apellido) -- la bandera N corresponde al nombre N.
   */
  countries: (string | null)[];
};

export type ScoreboardScore = {
  partId: string;
  teamId: string;
  status: ScoreStatus;
  value: number | null;
  reps: number | null;
  capValue: number | null;
  tiebreak: number | null;
  roundBreakdown: RoundBreakdownStep[] | null;
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
    /** El default mientras una (categoria, etapa) todavia no tiene snapshot. */
    tiePointPolicy: TiePointPolicy;
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
    roundBreakdown: s.roundBreakdown ?? null,
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

    // PASO 1: cada etapa se rankea AISLADA, contra SU PROPIO pool y SU
    // PROPIA curva -- exactamente como corrio en la realidad. El placement y
    // los puntos que un equipo se gano en el WOD 1 (contra 30 atletas) se
    // calculan UNA sola vez aca y nunca se recalculan despues, ni siquiera al
    // mirar la vista de la final con 6 finalistas: renkear una prueba vieja
    // contra el pool angosto de hoy le borraria el resultado real que sacaron
    // los eliminados, y el signo del corte no es "esto nunca paso", es
    // "estos siguen, los demas no".
    const entradasPorEtapa = new Map<number, OverallEntry[]>();
    const partesPorEtapaOrdenadas = new Map<number, ScoreboardPart[]>();

    for (const stage of etapas) {
      const partes = [...(partesPorEtapa.get(stage) ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      partesPorEtapaOrdenadas.set(stage, partes);

      // Quien compite en esta etapa: en la 1, toda la categoria. De ahi en
      // mas, SOLO quien avanzo -- una decision explicita del organizador, que
      // puede no haberse tomado todavia.
      const equipoIds =
        stage === 1
          ? equipos.map((t) => t.id)
          : [...(avanzanPorDivisionYEtapa.get(`${division.id}|${stage}`) ?? [])];

      if (equipoIds.length === 0) {
        entradasPorEtapa.set(stage, []);
        continue;
      }

      // La curva de esta etapa: la congelada si ya se genero, o una al vuelo
      // con el field que la corrio. Una carrera hibrida no reparte puntos.
      // La politica de empate sale del SNAPSHOT si ya existe -- es la
      // autoridad, congelada junto con la curva -- y del evento mientras se
      // previsualiza.
      const snapshot = snapshotPorDivisionYEtapa.get(`${division.id}|${stage}`);
      const tabla: ScoringTable = tablaDeCategoria({
        formato: input.event.format,
        snapshot: snapshot ? snapshot.points : null,
        fieldSize: equipoIds.length,
        tiePolicy: snapshot ? snapshot.tiePointPolicy : input.event.tiePointPolicy,
      });

      // El peso de cada prueba escala esa misma curva. Antes esto se
      // expresaba asignandole otra TABLA a la parte; un multiplicador dice lo
      // mismo sin poder desincronizarse de la curva de la categoria.
      const pesoPorParte = new Map(partes.map((p) => [p.id, p.maxPoints]));
      const specs: PartSpec[] = partes.map((p) => specPorId.get(p.id)).filter((s): s is PartSpec => Boolean(s));

      entradasPorEtapa.set(
        stage,
        computeOverall({
          parts: specs,
          tableFor: (part) => escalarTabla(tabla, pesoPorParte.get(part.id) ?? 100),
          teamIds: equipoIds,
          scores: crudos,
        }),
      );
    }

    // PASO 2: la VISTA de la etapa N acumula lo ya calculado en las etapas
    // 1..N -- suma de puntos y union de placements -- y solo vuelve a
    // rankear (assignPhysicalPositions) el TOTAL entre quienes siguen en el
    // pool de N. Un corte reduce quien sigue compitiendo, pero nunca reinicia
    // los puntos: es la regla de dominio de Scora para fases y cortes dentro
    // de una misma competencia.
    for (const stage of [...etapas].sort((a, b) => a - b)) {
      const entradasDeLaEtapa = entradasPorEtapa.get(stage) ?? [];
      if (entradasDeLaEtapa.length === 0) continue;

      const poolDeLaEtapa = new Set(entradasDeLaEtapa.map((e) => e.teamId));
      const etapasAcumulables = [...etapas].filter((s) => s <= stage).sort((a, b) => a - b);

      const partesAcumuladas = etapasAcumulables.flatMap(
        (s) => partesPorEtapaOrdenadas.get(s) ?? [],
      );
      const ordenDeParte = new Map(partesAcumuladas.map((p, i) => [p.id, i]));

      const acumulado = new Map<string, { placements: PartPlacement[]; totalPoints: number }>();
      for (const teamId of poolDeLaEtapa) acumulado.set(teamId, { placements: [], totalPoints: 0 });

      for (const s of etapasAcumulables) {
        for (const entrada of entradasPorEtapa.get(s) ?? []) {
          const acc = acumulado.get(entrada.teamId);
          if (!acc) continue; // quedo eliminado en un corte anterior a esta vista.
          acc.placements.push(...entrada.placements);
          acc.totalPoints += entrada.totalPoints;
        }
      }

      // La direccion de la suma es la misma en toda la categoria (mezclar
      // direcciones entre etapas seria una configuracion incoherente que la
      // UI no ofrece), asi que alcanza con la de cualquier etapa ya resuelta.
      const dir = tablaDeCategoria({ formato: input.event.format, snapshot: null, fieldSize: 1 }).dir;

      const listaAcumulada = [...acumulado.entries()].map(([teamId, { placements, totalPoints }]) => {
        const ordenados = [...placements].sort(
          (a, b) => (ordenDeParte.get(a.partId) ?? 0) - (ordenDeParte.get(b.partId) ?? 0),
        );
        return {
          teamId,
          // Misma limpieza de ruido de punto flotante que en computeOverall:
          // aca se suman totales de VARIAS etapas, cada uno ya redondeado.
          totalPoints: redondear(totalPoints),
          placements: ordenados,
          tiebreakVector: ordenados.map((p) => p.position).sort((a, b) => a - b),
        };
      });

      const ubicados = assignPhysicalPositions(listaAcumulada, compararEntradasGenerales(dir));

      const entries = ubicados.flatMap(({ item, position, tiedWith }) => {
        const team = equipoPorId.get(item.teamId);
        if (!team) return [];
        const entrada: OverallEntry & { team: ScoreboardTeam } = {
          teamId: item.teamId,
          totalPoints: item.totalPoints,
          displayPoints: Math.round(item.totalPoints),
          placements: item.placements,
          tiebreakVector: item.tiebreakVector,
          position,
          tiedWith,
          team,
        };
        return [entrada];
      });

      if (entries.length === 0) continue;

      resultados.push({ division, stage, parts: partesAcumuladas, entries });
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
