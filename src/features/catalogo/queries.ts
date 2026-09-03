import { createPublicClient } from "@/lib/supabase/public";
import type { EventFormat, EventType } from "@/lib/supabase/types";

/**
 * Lecturas del catalogo publico.
 *
 * Todo pasa por el cliente anonimo y por funciones `public_*`. El rol `anon` no
 * tiene GRANT sobre ninguna tabla: si aparece aca un `.from("events")`, esta
 * mal.
 */

export interface FichaDeCatalogo {
  slug: string;
  nombre: string;
  descripcion: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  formato: EventFormat;
  modalidad: EventType;
  pais: string | null;
  region: string | null;
  ciudad: string | null;
  sede: string | null;
  empiezaEn: string | null;
  terminaEn: string | null;
  cierranInscripciones: string | null;
  timezone: string;
  organiza: string | null;
  destacado: boolean;
  inscripcionesAbiertas: boolean;
}

export interface Catalogo {
  eventos: FichaDeCatalogo[];
  total: number;
}

export interface FiltrosDeCatalogo {
  busqueda?: string;
  pais?: string;
  ciudad?: string;
  /** 1 a 12. Independiente del año: "todos los marzos" es una busqueda real. */
  mes?: number;
  anio?: number;
  formato?: EventFormat;
  desde?: string;
  hasta?: string;
  destacados?: boolean;
  slugs?: string[];
  limite?: number;
  offset?: number;
}

const VACIO: Catalogo = { eventos: [], total: 0 };

export async function getCatalogo(filtros: FiltrosDeCatalogo = {}): Promise<Catalogo> {
  const supabase = createPublicClient();

  const { data, error } = await supabase.rpc("public_events_catalog", {
    p_busqueda: filtros.busqueda || undefined,
    p_pais: filtros.pais || undefined,
    p_ciudad: filtros.ciudad || undefined,
    p_mes: filtros.mes || undefined,
    p_anio: filtros.anio || undefined,
    p_formato: filtros.formato || undefined,
    p_desde: filtros.desde || undefined,
    p_hasta: filtros.hasta || undefined,
    p_destacados: filtros.destacados ?? false,
    p_slugs: filtros.slugs && filtros.slugs.length > 0 ? filtros.slugs : undefined,
    p_limite: filtros.limite,
    p_offset: filtros.offset,
  });

  if (error || !data) return VACIO;

  const filas = data as unknown as Array<Record<string, unknown>>;

  return {
    eventos: filas.map((f) => ({
      slug: String(f.public_slug),
      nombre: String(f.name),
      descripcion: (f.description as string | null) ?? null,
      logoUrl: (f.logo_url as string | null) ?? null,
      coverUrl: (f.cover_url as string | null) ?? null,
      formato: f.format as EventFormat,
      modalidad: f.event_type as EventType,
      pais: (f.country as string | null) ?? null,
      region: (f.state as string | null) ?? null,
      ciudad: (f.city as string | null) ?? null,
      sede: (f.venue as string | null) ?? null,
      empiezaEn: (f.starts_at as string | null) ?? null,
      terminaEn: (f.ends_at as string | null) ?? null,
      cierranInscripciones: (f.registration_closes_at as string | null) ?? null,
      timezone: String(f.timezone ?? "America/Bogota"),
      organiza: (f.organizer_name as string | null) ?? null,
      destacado: Boolean(f.destacado),
      inscripcionesAbiertas: Boolean(f.inscripciones_abiertas),
    })),
    total: Number(filas[0]?.total ?? 0),
  };
}

export interface OpcionesDeFiltro {
  paises: Array<{ codigo: string; cantidad: number }>;
  /** Cada ciudad viaja con su pais, para encadenar los dos selectores. */
  ciudades: Array<{ nombre: string; pais: string | null; cantidad: number }>;
  meses: Array<{ mes: number; cantidad: number }>;
  anios: Array<{ anio: number; cantidad: number }>;
}

const SIN_OPCIONES: OpcionesDeFiltro = {
  paises: [],
  ciudades: [],
  meses: [],
  anios: [],
};

/**
 * Lo que REALMENTE hay para filtrar.
 *
 * Ofrecer los veintidos paises de la lista cuando hay competencias en dos es
 * prometerle al usuario resultados que no existen. Los meses son la excepcion y
 * los pinta la pantalla: ahi solo viaja el conteo.
 */
export async function getOpcionesDeFiltro(): Promise<OpcionesDeFiltro> {
  const supabase = createPublicClient();
  const { data } = await supabase.rpc("public_catalog_filters");

  const doc = data as unknown as Partial<OpcionesDeFiltro> | null;
  if (!doc) return SIN_OPCIONES;

  return {
    paises: doc.paises ?? [],
    ciudades: doc.ciudades ?? [],
    meses: doc.meses ?? [],
    anios: doc.anios ?? [],
  };
}

export interface MovimientoPublico {
  nombre: string | null;
  unidad: string;
  /** Un valor por ronda. Longitud 1 = igual en todas. */
  objetivo: number[] | null;
  cargaKg: number | null;
  maxReps: boolean;
  notas: string | null;
  /** El peso y las reps de cada categoria: Rx y Scaled no levantan lo mismo. */
  porCategoria: Array<{
    division: string;
    objetivo: number[] | null;
    cargaKg: number | null;
    notas: string | null;
  }>;
}

export interface BloquePublico {
  kind: string;
  label: string | null;
  rondas: number;
  duracionMs: number | null;
  descansoMs: number | null;
  movimientos: MovimientoPublico[];
}

export interface ParteDeWodPublica {
  label: string;
  timeScheme: string;
  scoreUnit: string;
  scoreDir: string;
  teamMode: string;
  timeCapMs: number | null;
  windowMs: number | null;
  intervalMs: number | null;
  divisiones: string[];
  blocks: BloquePublico[];
}

export interface HeatPublico {
  name: string;
  scheduledAt: string | null;
  scheduledEndAt: string | null;
  arena: string | null;
  division: string | null;
  workout: string | null;
  lanes: number | null;
}

export interface EventoPublico {
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  format: EventFormat;
  eventType: EventType;
  status: string;
  country: string | null;
  state: string | null;
  city: string | null;
  venue: string | null;
  address: string | null;
  startsAt: string | null;
  endsAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  timezone: string;
  organizerName: string | null;
  instagram: string | null;
  website: string | null;
  shirtSizes: string[];
  inscripcionesAbiertas: boolean;
  resultadosVisibles: boolean;
  divisions: Array<{
    name: string;
    teamSize: number;
    genderRule: string;
    ageMin: number | null;
    ageMax: number | null;
    level: string | null;
    /** Null = gratis. Cero tambien puede ser un precio mal cargado, por eso no alcanza. */
    priceCents: number | null;
    currency: string | null;
    /** Null = sin limite de cupo. */
    capacity: number | null;
    /** Null cuando no hay limite; si no, cuantos quedan. */
    cuposDisponibles: number | null;
  }>;
  workouts: Array<{
    name: string;
    liberado: boolean;
    description: string | null;
    parts: ParteDeWodPublica[];
  }>;
  documents: Array<{ name: string; url: string }>;
  arenas: string[];
  schedule: HeatPublico[];
}

/** La ficha publica. null si el evento no existe o no esta publicado. */
export async function getEventoPublico(slug: string): Promise<EventoPublico | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("public_event_detail", { p_public_slug: slug });

  if (error || !data) return null;
  return data as unknown as EventoPublico;
}

export interface EquipoInscrito {
  dorsal: number;
  nombre: string;
  integrantes: string[];
}

export interface Inscritos {
  evento: string;
  divisiones: Array<{ nombre: string; equipos: EquipoInscrito[] }>;
}

/**
 * La lista de largada.
 *
 * Es lo que llena la pestaña de leaderboards ANTES de que haya un solo
 * resultado: entre que alguien se inscribe y que la competencia arranca pasan
 * semanas, y en todo ese tiempo la pregunta es "¿quien mas se anoto en mi
 * categoria?".
 */
export async function getInscritos(slug: string): Promise<Inscritos | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("public_participants", { p_public_slug: slug });
  if (error || !data) return null;
  return data as unknown as Inscritos;
}
