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

import type { Database, Json, Tables, TablesInsert, Enums } from "./database.types";

export type { Database, Json };

/**
 * Lo que la app manda al crear un heat.
 *
 * `workout_id` es NOT NULL y la llena el trigger `heats_prueba_por_defecto`
 * ANTES del insert. El generador de tipos no puede saberlo —ve una columna
 * obligatoria sin default— asi que exige un valor que la app no debe mandar:
 * `createHeat` no sabe que existen las pruebas y no tiene por que aprenderlo.
 *
 * Este alias es el unico lugar donde se dice "esa columna la pone la base".
 */
export type HeatInsert = Omit<TablesInsert<"heats">, "workout_id">;

/** El tipo completo, solo para el cast del insert. Ver `HeatInsert`. */
export type HeatInsertConTrigger = TablesInsert<"heats">;

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
export type TimeScheme = Enums<"time_scheme">;
export type ScoreUnitDb = Enums<"score_unit">;
export type ScoreDirDb = Enums<"score_dir">;
export type ScoreStatusDb = Enums<"score_status">;
export type CaptureMode = Enums<"capture_mode">;
export type BlockKind = Enums<"block_kind">;
export type TeamMode = Enums<"team_mode">;
export type MovementUnit = Enums<"movement_unit">;
export type MovementCategory = Enums<"movement_category">;
export type TiebreakSource = Enums<"tiebreak_source">;
export type OrgPlan = Enums<"org_plan">;
export type EventType = Enums<"event_type">;
export type EventFormat = Enums<"event_format">;
export type EventDocumentKind = Enums<"event_document_kind">;
export type LoadUnit = Enums<"load_unit">;
export type RegistrationStatus = Enums<"registration_status">;
export type RegistrationMemberStatus = Enums<"registration_member_status">;
export type RegistrationFieldType = Enums<"registration_field_type">;
export type PaymentProvider = Enums<"payment_provider">;
export type OrderStatus = Enums<"order_status">;
export type DiscountKind = Enums<"discount_kind">;
export type EventStaffRole = Enums<"event_staff_role">;

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
export type MovementRow = Tables<"movements">;
export type ScoringTableRow = Tables<"scoring_tables">;
export type WorkoutRow = Tables<"workouts">;
export type WorkoutPartRow = Tables<"workout_parts">;
export type PartDivisionRow = Tables<"part_divisions">;
export type PartBlockRow = Tables<"part_blocks">;
export type PartMovementRow = Tables<"part_movements">;
export type DivisionMovementSpec = Tables<"division_movement_specs">;
export type WorkoutScoreRow = Tables<"workout_scores">;
export type WorkoutScoreAudit = Tables<"workout_score_audit">;
export type StandingRow = Tables<"standings">;
export type EventDocumentRow = Tables<"event_documents">;
export type DivisionRegistration = Tables<"division_registration">;
export type RegistrationFieldRow = Tables<"registration_fields">;
export type RegistrationRow = Tables<"registrations">;
export type RegistrationMemberRow = Tables<"registration_members">;
export type PaymentProviderRow = Tables<"payment_providers">;
export type DiscountCodeRow = Tables<"discount_codes">;
export type OrderRow = Tables<"orders">;
export type PaymentAttemptRow = Tables<"payment_attempts">;
export type ArenaRow = Tables<"arenas">;
export type BillingAccountRow = Tables<"billing_accounts">;
export type EventStaffRow = Tables<"event_staff">;

/**
 * Lo que devuelve event_config_issues(). El generador la tipa como Json porque
 * es una funcion `returns table`, asi que la forma se declara aca a mano.
 */
export type ConfigIssue = {
  severity: "error" | "warning";
  code: string;
  detail: string;
};
