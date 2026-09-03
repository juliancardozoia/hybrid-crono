/**
 * De documento crudo a tabla general, listo para pintar.
 *
 * Es la entrada que consumen las pantallas. La base devuelve filas sin rankear
 * —ni posiciones, ni puntos, ni desempates— y todo eso se calcula aca, con las
 * mismas funciones puras que usa el recalculo del servidor. Por eso el
 * leaderboard en vivo y el oficial no pueden diferir: no hay dos
 * implementaciones que puedan divergir, hay una.
 */

import { computeOverall } from "./overall";
import { resolverTabla } from "./points";
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
  /** Clave de una tabla del codigo, o el id de una personalizada. */
  scoringTable: string;
  customPoints: number[];
};

export type ScoreboardPart = {
  id: string;
  workoutId: string;
  workoutName: string;
  label: string;
  orderIndex: number;
  scoreUnit: ScoreUnit;
  scoreDir: ScoreDir;
  capUnit: ScoreUnit | null;
  tiebreakUnit: ScoreUnit | null;
  tiebreakDir: ScoreDir | null;
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

/** Mapea uno a uno lo que devuelve public_scoreboard(). */
export type ScoreboardInput = {
  version: number;
  detalle: boolean;
  event: { name: string; venue: string | null; status: string; official: boolean };
  divisions: ScoreboardDivision[];
  parts: ScoreboardPart[];
  assignments: Array<{ partId: string; divisionId: string }>;
  teams: ScoreboardTeam[];
  scores: ScoreboardScore[];
};

export type ScoreboardDivisionResult = {
  division: ScoreboardDivision;
  parts: ScoreboardPart[];
  entries: Array<OverallEntry & { team: ScoreboardTeam }>;
};

export function buildScoreboard(input: ScoreboardInput): ScoreboardDivisionResult[] {
  const partePorId = new Map(input.parts.map((p) => [p.id, p]));

  const crudos: RawScore[] = input.scores.map((s) => ({
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

  return input.divisions
    .map((division): ScoreboardDivisionResult => {
      const equipos = input.teams.filter((t) => t.divisionId === division.id);

      const partes = input.assignments
        .filter((a) => a.divisionId === division.id)
        .map((a) => partePorId.get(a.partId))
        .filter((p): p is ScoreboardPart => Boolean(p))
        .sort((a, b) => a.orderIndex - b.orderIndex);

      const tabla: ScoringTable = resolverTabla(
        esClaveDelCodigo(division.scoringTable) ? division.scoringTable : null,
        division.customPoints,
        division.name,
      );

      const specs: PartSpec[] = partes.map((p) => ({
        id: p.id,
        orderIndex: p.orderIndex,
        scoreUnit: p.scoreUnit,
        scoreDir: p.scoreDir,
        capUnit: p.capUnit,
        tiebreakUnit: p.tiebreakUnit,
        tiebreakDir: p.tiebreakDir,
      }));

      const general = computeOverall({
        parts: specs,
        tableFor: () => tabla,
        teamIds: equipos.map((t) => t.id),
        scores: crudos,
      });

      const equipoPorId = new Map(equipos.map((t) => [t.id, t]));

      return {
        division,
        parts: partes,
        entries: general.flatMap((entrada) => {
          const team = equipoPorId.get(entrada.teamId);
          return team ? [{ ...entrada, team }] : [];
        }),
      };
    })
    .filter((d) => d.entries.length > 0)
    .sort((a, b) => a.division.name.localeCompare(b.division.name));
}

function aNumero(valor: number | string | null): number | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

const CLAVES_DEL_CODIGO = new Set(["tiempo_total", "cf_games_40", "cf_games_80", "cf_open"]);

function esClaveDelCodigo(valor: string): boolean {
  return CLAVES_DEL_CODIGO.has(valor);
}
