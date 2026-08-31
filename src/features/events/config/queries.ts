import { createClient } from "@/lib/supabase/server";
import type {
  AthleteRow,
  ConfigIssue,
  CourseTemplate,
  DivisionRow,
  HeatRow,
  LaneRow,
  PenaltyType,
  SegmentRow,
  TeamRow,
} from "@/lib/supabase/types";

/**
 * Lecturas de la configuracion de una competencia.
 *
 * Ninguna filtra por organizacion: RLS ya lo hace. Repetir el filtro aca daria
 * la falsa impresion de que la seguridad depende de estas funciones.
 */

export async function getCourseTemplates(eventId: string): Promise<CourseTemplate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("course_templates")
    .select("*")
    .eq("event_id", eventId)
    .order("created_at");
  return data ?? [];
}

export async function getSegments(templateId: string): Promise<SegmentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("segments")
    .select("*")
    .eq("course_template_id", templateId)
    .order("order_index");
  return data ?? [];
}

export async function getDivisions(eventId: string): Promise<DivisionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("divisions")
    .select("*")
    .eq("event_id", eventId)
    .order("name");
  return data ?? [];
}

export async function getPenaltyTypes(eventId: string): Promise<PenaltyType[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("penalty_types")
    .select("*")
    .eq("event_id", eventId)
    .order("code");
  return data ?? [];
}

export interface TeamWithMembers extends TeamRow {
  divisionName: string;
  members: Array<Pick<AthleteRow, "id" | "first_name" | "last_name" | "gender" | "birth_date">>;
}

export async function getTeams(eventId: string): Promise<TeamWithMembers[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("teams")
    .select(
      "*, divisions (name), team_members (athletes (id, first_name, last_name, gender, birth_date))",
    )
    .eq("event_id", eventId)
    .order("bib_number");

  if (!data) return [];

  return data.map((row) => {
    const { divisions, team_members, ...team } = row as unknown as TeamRow & {
      divisions: { name: string } | null;
      team_members: Array<{ athletes: TeamWithMembers["members"][number] | null }>;
    };

    return {
      ...team,
      divisionName: divisions?.name ?? "—",
      members: team_members.flatMap((m) => (m.athletes ? [m.athletes] : [])),
    };
  });
}

export async function getExistingBibs(eventId: string): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("teams").select("bib_number").eq("event_id", eventId);
  return (data ?? []).map((t) => t.bib_number);
}

export interface HeatWithLanes extends HeatRow {
  lanes: Array<
    LaneRow & {
      bib: number | null;
      /** Nombre del equipo, si tiene. Los individuales no suelen tener. */
      teamLabel: string | null;
      /** Quien corre: "Ana Diaz" o "Ana Diaz / Beto Ruiz" en parejas. */
      athletes: string | null;
    }
  >;
}

type TeamEmbebido = {
  bib_number: number;
  name: string | null;
  team_members: Array<{ athletes: { first_name: string; last_name: string } | null }>;
};

export async function getHeats(eventId: string): Promise<HeatWithLanes[]> {
  const supabase = await createClient();

  // El embed baja hasta los atletas porque la torre de control necesita saber
  // QUIEN esta en el carril, no solo su dorsal: un numero suelto no sirve para
  // encontrar a alguien en el piso ni para cruzarlo con la planilla de papel.
  const { data } = await supabase
    .from("heats")
    .select(
      "*, lanes (*, teams (bib_number, name, team_members (athletes (first_name, last_name))))",
    )
    .eq("event_id", eventId)
    .order("scheduled_at", { nullsFirst: false })
    .order("name");

  if (!data) return [];

  return data.map((row) => {
    const { lanes, ...heat } = row as unknown as HeatRow & {
      lanes: Array<LaneRow & { teams: TeamEmbebido | null }>;
    };

    return {
      ...heat,
      lanes: [...lanes]
        .sort((a, b) => a.lane_number - b.lane_number)
        .map(({ teams, ...lane }) => {
          const nombres = (teams?.team_members ?? [])
            .flatMap((m) =>
              m.athletes ? [`${m.athletes.first_name} ${m.athletes.last_name}`] : [],
            )
            .join(" / ");

          return {
            ...lane,
            bib: teams?.bib_number ?? null,
            teamLabel: teams?.name ?? null,
            athletes: nombres || null,
          };
        }),
    };
  });
}

export async function getConfigIssues(eventId: string): Promise<ConfigIssue[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("event_config_issues", { p_event_id: eventId });
  return (data as ConfigIssue[]) ?? [];
}

export interface JudgeOption {
  userId: string;
  label: string;
  role: string;
}

/** Miembros de la organizacion que pueden juzgar, para el selector de carril. */
export async function getJudges(orgId: string): Promise<JudgeOption[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("org_members")
    .select("user_id, role, profiles (full_name, email)")
    .eq("org_id", orgId);

  if (!data) return [];

  return data
    .map((row) => {
      const perfil = row.profiles as unknown as {
        full_name: string | null;
        email: string | null;
      } | null;

      return {
        userId: row.user_id,
        role: row.role,
        // El UUID es el ultimo recurso: si el perfil todavia no sincronizo,
        // mostrar algo es mejor que mostrar una fila vacia.
        label: perfil?.full_name ?? perfil?.email ?? row.user_id.slice(0, 8),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
