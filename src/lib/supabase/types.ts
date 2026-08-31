/**
 * Alias con nombre sobre el esquema generado.
 *
 * `database.types.ts` es un archivo GENERADO: se sobrescribe entero con
 *
 *   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 *
 * Por eso nada de la app lo importa directo. Los nombres que usa el codigo viven
 * aca, derivados de aquel: si una columna cambia en la base, el error aparece en
 * este archivo y no desparramado por toda la aplicacion.
 */

import type { Database, Tables, Enums } from "./database.types";

export type { Database };

// --- Enums ------------------------------------------------------------------

export type OrgRole = Enums<"org_role">;
export type EventStatus = Enums<"event_status">;
export type SegmentKind = Enums<"segment_kind">;
export type GenderRule = Enums<"gender_rule">;
export type PenaltyKind = Enums<"penalty_kind">;
export type AthleteGender = Enums<"athlete_gender">;
export type TeamStatus = Enums<"team_status">;
export type HeatStatus = Enums<"heat_status">;
export type LaneStatus = Enums<"lane_status">;
export type StartSource = Enums<"start_source">;
export type TimingEventType = Enums<"timing_event_type">;

// --- Filas ------------------------------------------------------------------

export type Organization = Tables<"organizations">;
export type OrgMember = Tables<"org_members">;
export type EventRow = Tables<"events">;
export type Profile = Tables<"profiles">;
export type CourseTemplate = Tables<"course_templates">;
export type SegmentRow = Tables<"segments">;
export type DivisionRow = Tables<"divisions">;
export type DivisionSegmentSpec = Tables<"division_segment_specs">;
export type PenaltyType = Tables<"penalty_types">;
export type AthleteRow = Tables<"athletes">;
export type TeamRow = Tables<"teams">;
export type TeamMemberRow = Tables<"team_members">;
export type HeatRow = Tables<"heats">;
export type LaneRow = Tables<"lanes">;
export type TimingEventRow = Tables<"timing_events">;
export type ResultRow = Tables<"results">;
export type ResultPublication = Tables<"result_publications">;
export type LaneAudit = Tables<"lane_audit">;

/**
 * Lo que devuelve event_config_issues(). El generador la tipa como Json porque
 * es una funcion `returns table`, asi que la forma se declara aca a mano.
 */
export type ConfigIssue = {
  severity: "error" | "warning";
  code: string;
  detail: string;
};
