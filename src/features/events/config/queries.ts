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
  members: Array<
    Pick<
      AthleteRow,
      | "id"
      | "first_name"
      | "last_name"
      | "gender"
      | "birth_date"
      | "email"
      | "phone"
      | "country"
      | "document_id"
      | "state_province"
    >
  >;
}

export async function getTeams(eventId: string): Promise<TeamWithMembers[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("teams")
    .select(
      "*, divisions (name), team_members (athletes (id, first_name, last_name, gender, birth_date, email, phone, country, document_id, state_province))",
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
/**
 * Los jueces disponibles para asignar carriles.
 *
 * SALEN DE `event_staff`, NO DE `org_members`. Antes se ofrecian los miembros de
 * la organizacion, que es lo que existia cuando los jueces se invitaban una vez
 * y valian para todos los eventos. Con jueces por competencia eso ofrecia gente
 * que no tiene nada que ver con ESTA fecha —y, peor, dejaba fuera a quien fue
 * invitado solo a ella.
 *
 * Sin embeds a proposito: un embed invalido pasa los tests de PGlite y devuelve
 * PGRST200 en produccion, y como el codigo hace `data ?? []` la pantalla queda
 * vacia sin mostrar ningun error. Es exactamente el incidente que documenta el
 * CLAUDE.md.
 */
export async function getJudges(eventId: string): Promise<JudgeOption[]> {
  const supabase = await createClient();

  // Sin aprobar todavia no cuenta: es lo mismo que decide event_staff_role()
  // para el resto del sistema. Sin este filtro, una postulacion publica sin
  // revisar aparecia como elegible en el selector de "asignar juez" de un
  // carril, antes de que la organizacion la hubiera aprobado.
  const { data } = await supabase
    .from("event_staff")
    .select("user_id, role, invited_email")
    .eq("event_id", eventId)
    .not("user_id", "is", null)
    .not("approved_at", "is", null);

  if (!data) return [];

  const ids = data.map((r) => r.user_id).filter((u): u is string => Boolean(u));
  const { data: perfiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };

  const porId = new Map((perfiles ?? []).map((p) => [p.id, p]));

  return data
    .flatMap((row) => {
      if (!row.user_id) return [];
      const perfil = porId.get(row.user_id);
      return [
        {
          userId: row.user_id,
          role: row.role,
          // El correo antes que el uuid: si el perfil todavia no sincronizo,
          // mostrar algo reconocible es mejor que ocho caracteres al azar.
          label: perfil?.full_name || perfil?.email || row.invited_email,
        },
      ];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Los documentos de la competencia, para el asistente y la ficha del panel. */
export async function getDocumentos(eventId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("event_documents")
    .select("id, name, url, kind, requires_acceptance")
    .eq("event_id", eventId)
    .order("order_index");

  return (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    url: d.url,
    kind: d.kind,
    requiresAcceptance: d.requires_acceptance,
  }));
}

export interface MovimientoDeCategoria {
  id: string;
  nombre: string;
  loadKg: number | null;
  loadUnit: "kg" | "lb";
  spec: string | null;
}

export interface CategoriaConfigurada {
  id: string;
  name: string;
  teamSize: number;
  genderRule: string;
  ageMin: number | null;
  ageMax: number | null;
  courseTemplateId: string | null;
  capacity: number | null;
  /** Solo aplica si compite mas de una persona. */
  permiteCambios: boolean;
  /** Si se puede cambiar la categoria de un equipo ya inscripto en esta.
   *  Default false: mover un equipo ya asignado a un heat puede dejar
   *  carriles y resultados apuntando a una categoria que ya no es la suya. */
  permiteCambioCategoria: boolean;
  /** Cuantos equipos ya corren en esta categoria. Si es > 0, no se puede borrar
   *  —`teams.division_id` es `on delete restrict`— asi que la pantalla ni
   *  siquiera ofrece el boton. */
  equiposInscritos: number;
  movimientos: MovimientoDeCategoria[];
  /** Ajustes del circuito para esta categoria, por segmento. */
  segmentos: Record<
    string,
    { distanceM: number | null; targetReps: number | null; loadKg: number | null; notes: string | null }
  >;
}

/**
 * Las categorias con TODO lo que hace falta para configurarlas.
 *
 * Sin embeds a proposito: un embed invalido pasa los tests de PGlite y devuelve
 * PGRST200 en produccion, y como el codigo hace `data ?? []` la pantalla queda
 * vacia sin mostrar ningun error. Son cuatro consultas planas.
 */
export async function getCategoriasConfiguradas(
  eventId: string,
): Promise<CategoriaConfigurada[]> {
  const supabase = await createClient();

  const [{ data: divisiones }, { data: registros }, { data: movimientos }, { data: specs }, { data: equipos }] =
    await Promise.all([
      supabase
        .from("divisions")
        .select("id, name, team_size, gender_rule, age_min, age_max, course_template_id")
        .eq("event_id", eventId)
        .order("name"),
      supabase
        .from("division_registration")
        .select("division_id, capacity, allows_member_swap, allows_division_change")
        .eq("event_id", eventId),
      supabase
        .from("division_movements")
        .select("id, division_id, movement_id, custom_name, load_kg, load_unit, spec, order_index")
        .eq("event_id", eventId)
        .order("order_index"),
      supabase
        .from("division_segment_specs")
        .select("division_id, segment_id, distance_m, target_reps, load_kg, notes")
        .eq("event_id", eventId),
      supabase.from("teams").select("division_id").eq("event_id", eventId),
    ]);

  // Los nombres del catalogo, en una consulta mas y no en un embed.
  const ids = (movimientos ?? [])
    .map((m) => m.movement_id)
    .filter((v): v is string => Boolean(v));

  const { data: catalogo } = ids.length
    ? await supabase.from("movements").select("id, name").in("id", ids)
    : { data: [] };

  const nombreDeMovimiento = new Map((catalogo ?? []).map((m) => [m.id, m.name]));
  const registroPorDivision = new Map((registros ?? []).map((r) => [r.division_id, r]));

  const equiposPorDivision = new Map<string, number>();
  for (const e of equipos ?? []) {
    if (!e.division_id) continue;
    equiposPorDivision.set(e.division_id, (equiposPorDivision.get(e.division_id) ?? 0) + 1);
  }

  return (divisiones ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    teamSize: d.team_size,
    genderRule: d.gender_rule,
    ageMin: d.age_min,
    ageMax: d.age_max,
    courseTemplateId: d.course_template_id,
    capacity: registroPorDivision.get(d.id)?.capacity ?? null,
    permiteCambios: registroPorDivision.get(d.id)?.allows_member_swap ?? false,
    permiteCambioCategoria:
      registroPorDivision.get(d.id)?.allows_division_change ?? false,
    equiposInscritos: equiposPorDivision.get(d.id) ?? 0,
    movimientos: (movimientos ?? [])
      .filter((m) => m.division_id === d.id)
      .map((m) => ({
        id: m.id,
        nombre: m.movement_id
          ? (nombreDeMovimiento.get(m.movement_id) ?? "Movimiento")
          : (m.custom_name ?? "Movimiento"),
        loadKg: m.load_kg === null ? null : Number(m.load_kg),
        loadUnit: m.load_unit as "kg" | "lb",
        spec: m.spec,
      })),
    segmentos: Object.fromEntries(
      (specs ?? [])
        .filter((s) => s.division_id === d.id)
        .map((s) => [
          s.segment_id,
          {
            distanceM: s.distance_m === null ? null : Number(s.distance_m),
            targetReps: s.target_reps,
            loadKg: s.load_kg === null ? null : Number(s.load_kg),
            notes: s.notes,
          },
        ]),
    ),
  }));
}

/** Los segmentos de un circuito, para ajustarlos por categoria. */
export async function getSegmentos(eventId: string, templateId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("segments")
    .select("id, name, kind, order_index")
    .eq("event_id", eventId)
    .eq("course_template_id", templateId)
    .order("order_index");
  return data ?? [];
}

/** El catalogo de movimientos, para el selector. */
export async function getCatalogoDeMovimientos() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("movements")
    .select("id, name, category, allows_load")
    .eq("active", true)
    .order("name");
  return data ?? [];
}

export interface ContactoDeLaOrganizacion {
  email: string;
  nombre: string;
  veces: number;
  ultimaCompetencia: string | null;
  fueJuez: boolean;
}

/**
 * Quienes ya trabajaron en OTRAS competencias de la organizacion.
 *
 * Es la memoria que hace viable invitar por evento: el acceso sigue siendo de
 * una sola competencia, pero no hay que volver a tipear doce correos cada vez.
 * No devuelve a quien ya esta en este evento.
 */
export async function getContactosDeLaOrganizacion(
  eventId: string,
): Promise<ContactoDeLaOrganizacion[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("org_staff_directory", { p_event_id: eventId });

  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((f) => ({
    email: String(f.email),
    nombre: String(f.nombre),
    veces: Number(f.veces),
    ultimaCompetencia: (f.ultima_competencia as string | null) ?? null,
    fueJuez: Boolean(f.fue_juez),
  }));
}

/** Un equipo tal como aparece en el pool de una etapa: solo lo que hace falta para reconocerlo. */
export interface EquipoDeEtapa {
  teamId: string;
  bib: number;
  nombre: string | null;
}

export interface EtapaDeCategoria {
  /** "Stage 1 con 40 -> cut -> Stage 2 con 20 -> cut -> Final". */
  stage: number;
  /** Quien puede avanzar A esta etapa: todos si viene de la 1, o quien avanzo de la anterior. */
  pool: EquipoDeEtapa[];
  /** Quien avanzo, si el corte ya se confirmo. Null = todavia no se decidio. */
  avanzan: string[] | null;
}

export interface PuntuacionDeCategoria {
  divisionId: string;
  nombre: string;
  /** Equipos confirmados y no retirados AHORA. */
  atletasActivos: number;
  /** La curva congelada, si ya se genero. */
  snapshot: number[] | null;
  fieldSize: number | null;
  bloqueada: boolean;
  /**
   * Los cortes de esta categoria, desde la etapa 2 en adelante. Vacio si
   * ninguna prueba del evento se asigno a una etapa mayor que 1 -- la mayoria
   * de las competencias no tienen cortes y no hay nada que mostrar aca.
   */
  etapas: EtapaDeCategoria[];
}

/**
 * Como se reparten los puntos en cada categoria del evento, y sus cortes.
 *
 * Devuelve las dos cifras que hay que poder comparar de un vistazo: con
 * cuantos atletas se congelo la tabla y cuantos hay hoy. Si difieren no es un
 * error —alguien se retiro despues de bloquear, que es exactamente lo que el
 * snapshot existe para tolerar— pero el organizador tiene que verlo.
 *
 * LA ETAPA ES DEL WORKOUT, NO DE LA PARTE: se resuelve cruzando
 * `part_divisions` (que categoria corre que parte) con `workout_parts.workout_id`
 * y `workouts.stage`, sin embeds -- un embed invalido pasa los tests de PGlite
 * y devuelve PGRST200 recien en produccion, y esto es exactamente lo que
 * documenta el CLAUDE.md sobre `lanes`/`events`.
 */
export async function getPuntuacionDelEvento(
  eventId: string,
): Promise<PuntuacionDeCategoria[]> {
  const supabase = await createClient();

  const [
    { data: divisiones },
    { data: equipos },
    { data: snapshots },
    { data: workouts },
    { data: partes },
    { data: asignaciones },
    { data: avances },
  ] = await Promise.all([
    supabase.from("divisions").select("id, name").eq("event_id", eventId).order("name"),
    supabase
      .from("teams")
      .select("id, division_id, status, bib_number, name")
      .eq("event_id", eventId),
    supabase
      .from("scoring_snapshots")
      .select("division_id, points, field_size, locked_at")
      .eq("event_id", eventId)
      .eq("stage", 1),
    supabase.from("workouts").select("id, stage").eq("event_id", eventId),
    supabase.from("workout_parts").select("id, workout_id").eq("event_id", eventId),
    supabase.from("part_divisions").select("part_id, division_id").eq("event_id", eventId),
    supabase
      .from("stage_advancements")
      .select("division_id, stage, team_id")
      .eq("event_id", eventId),
  ]);

  const activosPorDivision = new Map<string, number>();
  const equipoPorId = new Map(
    (equipos ?? []).map((t) => [t.id, { teamId: t.id, bib: t.bib_number, nombre: t.name }]),
  );
  const equiposActivosPorDivision = new Map<string, string[]>();
  for (const t of equipos ?? []) {
    if (t.status === "withdrawn") continue;
    activosPorDivision.set(t.division_id, (activosPorDivision.get(t.division_id) ?? 0) + 1);
    const lista = equiposActivosPorDivision.get(t.division_id) ?? [];
    lista.push(t.id);
    equiposActivosPorDivision.set(t.division_id, lista);
  }

  const snapshotPorDivision = new Map((snapshots ?? []).map((s) => [s.division_id, s]));

  // partId -> stage de su workout, y de ahi division -> etapas que corre.
  const stagePorWorkout = new Map((workouts ?? []).map((w) => [w.id, w.stage]));
  const stagePorParte = new Map(
    (partes ?? []).map((p) => [p.id, stagePorWorkout.get(p.workout_id) ?? 1]),
  );
  const etapasPorDivision = new Map<string, Set<number>>();
  for (const a of asignaciones ?? []) {
    const stage = stagePorParte.get(a.part_id);
    if (stage === undefined) continue;
    const set = etapasPorDivision.get(a.division_id) ?? new Set<number>();
    set.add(stage);
    etapasPorDivision.set(a.division_id, set);
  }

  // (division, etapa) -> equipos que avanzaron. Solo hay filas desde la
  // etapa 2: la 1 la corre todo equipo activo, sin decision que confirmar.
  const avanzanPorDivisionYEtapa = new Map<string, string[]>();
  for (const a of avances ?? []) {
    const clave = `${a.division_id}|${a.stage}`;
    const lista = avanzanPorDivisionYEtapa.get(clave) ?? [];
    lista.push(a.team_id);
    avanzanPorDivisionYEtapa.set(clave, lista);
  }

  return (divisiones ?? []).map((d) => {
    const sn = snapshotPorDivision.get(d.id);

    const maxStage = Math.max(1, ...(etapasPorDivision.get(d.id) ?? [1]));
    const etapas: EtapaDeCategoria[] = [];
    for (let stage = 2; stage <= maxStage; stage++) {
      const poolIds =
        stage === 2
          ? (equiposActivosPorDivision.get(d.id) ?? [])
          : (avanzanPorDivisionYEtapa.get(`${d.id}|${stage - 1}`) ?? []);

      etapas.push({
        stage,
        pool: poolIds.flatMap((id) => {
          const t = equipoPorId.get(id);
          return t ? [t] : [];
        }),
        avanzan: avanzanPorDivisionYEtapa.get(`${d.id}|${stage}`) ?? null,
      });
    }

    return {
      divisionId: d.id,
      nombre: d.name,
      atletasActivos: activosPorDivision.get(d.id) ?? 0,
      snapshot: sn ? sn.points.map(Number) : null,
      fieldSize: sn?.field_size ?? null,
      bloqueada: Boolean(sn?.locked_at),
      etapas,
    };
  });
}
