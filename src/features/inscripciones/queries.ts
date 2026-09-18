import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import type { Readiness } from "./lib/estados";
import type {
  EventFormat,
  EventStatus,
  RegistrationFieldType,
  RegistrationMemberRow,
  RegistrationRow,
} from "@/lib/supabase/types";

/**
 * Lecturas de inscripciones.
 *
 * El formulario en blanco sale por el cliente publico —cualquiera puede ver que
 * se pide antes de decidir si se anota— y los tramites por el cliente del
 * usuario, donde RLS decide que ve cada uno: el capitan y los invitados ven el
 * suyo, la organizacion ve todos los de su evento, y un tercero no ve nada.
 */

export interface CategoriaParaInscribirse {
  id: string;
  name: string;
  teamSize: number;
  genderRule: string;
  ageMin: number | null;
  ageMax: number | null;
  level: string | null;
  priceCents: number | null;
  currency: string;
  cuposDisponibles: number | null;
  abierta: boolean;
}

export interface CampoDelFormulario {
  key: string;
  label: string;
  type: RegistrationFieldType;
  required: boolean;
  options: string[];
  scope: "equipo" | "integrante";
  divisionId: string | null;
  /**
   * Cuando se pide: "esencial" (antes de pagar) o "completa" (despues). Hoy
   * `CamposDeAtleta` sigue pidiendo todo junto sin mirar este campo -- queda
   * listo para cuando la pantalla se divida en dos pasos.
   */
  fase: "esencial" | "completa";
}

export interface FormularioDeInscripcion {
  slug: string;
  name: string;
  timezone: string;
  shirtSizes: string[];
  abierta: boolean;
  divisions: CategoriaParaInscribirse[];
  fields: CampoDelFormulario[];
  documents: Array<{ name: string; url: string; requiresAcceptance: boolean }>;
}

export async function getFormularioDeInscripcion(
  slug: string,
): Promise<FormularioDeInscripcion | null> {
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("public_registration_form", {
    p_public_slug: slug,
  });

  if (error || !data) return null;
  return data as unknown as FormularioDeInscripcion;
}

export interface InscripcionCompleta {
  registro: RegistrationRow;
  integrantes: RegistrationMemberRow[];
  evento: { name: string; publicSlug: string; timezone: string; shirtSizes: string[] };
  categoria: { name: string; teamSize: number };
}

export async function getInscripcion(id: string): Promise<InscripcionCompleta | null> {
  const supabase = await createClient();

  const { data: registro } = await supabase
    .from("registrations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!registro) return null;

  // Sin embeds a proposito: un embed invalido pasa los tests de PGlite y
  // devuelve la pantalla vacia en produccion, sin mostrar ningun error.
  const [{ data: integrantes }, { data: evento }, { data: categoria }] = await Promise.all([
    supabase
      .from("registration_members")
      .select("*")
      .eq("registration_id", id)
      .order("position"),
    supabase
      .from("events")
      .select("name, public_slug, timezone, shirt_sizes")
      .eq("id", registro.event_id)
      .maybeSingle(),
    supabase
      .from("divisions")
      .select("name, team_size")
      .eq("id", registro.division_id)
      .maybeSingle(),
  ]);

  if (!evento || !categoria) return null;

  return {
    registro,
    integrantes: integrantes ?? [],
    evento: {
      name: evento.name,
      publicSlug: evento.public_slug,
      timezone: evento.timezone,
      shirtSizes: evento.shirt_sizes,
    },
    categoria: { name: categoria.name, teamSize: categoria.team_size },
  };
}

/**
 * Llama a `registration_readiness`.
 *
 * FUNCION NUEVA, TODAVIA NO EN `database.types.ts`: ese archivo es generado
 * contra el proyecto de Supabase real (`npx supabase gen types typescript
 * --linked`), y esta migracion no se aplico ahi todavia. El `as never`/`as
 * unknown` de aca es exactamente ese hueco temporal -- cuando se regeneren
 * los tipos despues del `db push`, `registration_readiness` va a aparecer en
 * el union de RPCs solo y este cast deja de hacer falta (se puede sacar sin
 * tocar el resto de la funcion).
 */
async function llamarReadiness(
  supabase: Awaited<ReturnType<typeof createClient>>,
  registrationId: string,
): Promise<Readiness | null> {
  const { data, error } = await supabase.rpc("registration_readiness" as never, {
    p_registration_id: registrationId,
  } as never);
  if (error || !data) return null;
  return data as unknown as Readiness;
}

export async function getReadiness(registrationId: string): Promise<Readiness | null> {
  const supabase = await createClient();
  return llamarReadiness(supabase, registrationId);
}

/**
 * La misma consulta para varias inscripciones a la vez.
 *
 * `registration_readiness` toma un solo id -- no hay (todavia) una version
 * en lote, asi que esto es un viaje de red por fila via `Promise.all`.
 * Aceptable para "mis inscripciones" (unas pocas) y para la torre de
 * control de un evento chico o mediano; si algun evento crece a cientos de
 * inscripciones esto conviene revisarse (mover la logica a una consulta en
 * lote en vez de N llamadas al RPC).
 */
async function getReadinessEnLote(
  supabase: Awaited<ReturnType<typeof createClient>>,
  registrationIds: string[],
): Promise<Map<string, Readiness>> {
  const resultado = await Promise.all(
    registrationIds.map(async (id) => {
      const readiness = await llamarReadiness(supabase, id);
      return [id, readiness ?? "incompleto"] as const;
    }),
  );
  return new Map(resultado);
}

export interface ResumenDeInscripcion {
  id: string;
  status: RegistrationRow["status"];
  teamName: string | null;
  eventName: string;
  eventSlug: string;
  /** Para el widget de "mi proxima competencia": el afiche, si lo cargaron. */
  logoUrl: string | null;
  venue: string | null;
  /**
   * Estado de la COMPETENCIA, no del tramite (eso ya lo dice `status`). Sin
   * esto no hay forma de saber si conviene mostrarle al atleta un widget de
   * leaderboard/resultados o si el evento todavia ni arranco.
   */
  eventStatus: EventStatus;
  eventFormat: EventFormat;
  divisionName: string;
  startsAt: string | null;
  timezone: string;
  bib: number | null;
  readiness: Readiness;
}

/**
 * Las inscripciones donde el usuario es capitan o integrante.
 *
 * FILTRADO EXPLICITO por ser INTEGRANTE (`registration_members.profile_id`),
 * no por `created_by`. Se probaron las dos y la primera version (por
 * `created_by`) seguia mostrando de mas: el alta manual del organizador pone
 * al ORGANIZADOR como `created_by` de cada atleta que carga a mano (ver
 * "El alta manual de atletas..." — `created_by` es quien llama la funcion,
 * NUNCA el atleta), asi que una cuenta que administra un evento y ademas
 * carga atletas a mano seguia viendo esos registros en "Compito": su propio
 * id aparecia como `created_by` en cada uno.
 *
 * Ser integrante (tener una fila en `registration_members` con el propio
 * `profile_id`) es la unica señal que de verdad significa "yo compito aca":
 * el capitan de una auto-inscripcion SIEMPRE queda como integrante #1 con su
 * propio profile_id (`start_registration`), y un atleta cargado a mano NUNCA
 * tiene `profile_id` propio a menos que el mismo entre despues a reclamar su
 * lugar — que es exactamente cuando deberia empezar a aparecerle aca.
 */
export async function getMisInscripciones(): Promise<ResumenDeInscripcion[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: miembros } = await supabase
    .from("registration_members")
    .select("registration_id")
    .eq("profile_id", user.id);

  const registrationIds = [...new Set((miembros ?? []).map((m) => m.registration_id))];
  if (registrationIds.length === 0) return [];

  const { data: registros } = await supabase
    .from("registrations")
    .select("id, status, team_name, event_id, division_id, team_id")
    .in("id", registrationIds)
    .order("created_at", { ascending: false });

  if (!registros || registros.length === 0) return [];

  const teamIds = [...new Set(registros.map((r) => r.team_id).filter((id): id is string => id !== null))];

  const [{ data: eventos }, { data: divisiones }, { data: equipos }] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, public_slug, starts_at, timezone, status, format, logo_url, venue")
      .in("id", [...new Set(registros.map((r) => r.event_id))]),
    supabase
      .from("divisions")
      .select("id, name")
      .in("id", [...new Set(registros.map((r) => r.division_id))]),
    teamIds.length > 0
      ? supabase.from("teams").select("id, bib_number").in("id", teamIds)
      : Promise.resolve({ data: [] as Array<{ id: string; bib_number: number | null }> }),
  ]);

  const evento = new Map((eventos ?? []).map((e) => [e.id, e]));
  const division = new Map((divisiones ?? []).map((d) => [d.id, d.name]));
  const dorsal = new Map((equipos ?? []).map((t) => [t.id, t.bib_number]));
  const readiness = await getReadinessEnLote(supabase, registros.map((r) => r.id));

  return registros.flatMap((r) => {
    const e = evento.get(r.event_id);
    if (!e) return [];
    return [
      {
        id: r.id,
        status: r.status,
        teamName: r.team_name,
        eventName: e.name,
        eventSlug: e.public_slug,
        logoUrl: e.logo_url,
        venue: e.venue,
        eventStatus: e.status,
        eventFormat: e.format,
        divisionName: division.get(r.division_id) ?? "",
        startsAt: e.starts_at,
        timezone: e.timezone,
        bib: r.team_id ? (dorsal.get(r.team_id) ?? null) : null,
        readiness: readiness.get(r.id) ?? "incompleto",
      },
    ];
  });
}

export interface FilaDeInscripcion {
  id: string;
  status: RegistrationRow["status"];
  teamName: string | null;
  divisionName: string;
  bib: number | null;
  integrantes: Array<{
    nombre: string;
    email: string;
    completo: boolean;
    aceptoTerminos: boolean;
  }>;
  priceCents: number | null;
  currency: string | null;
  readiness: Readiness;
}

/** Todas las inscripciones de un evento, para la organizacion. */
export async function getInscripcionesDelEvento(eventId: string): Promise<FilaDeInscripcion[]> {
  const supabase = await createClient();

  const [{ data: registros }, { data: divisiones }] = await Promise.all([
    supabase
      .from("registrations")
      .select("id, status, team_name, division_id, team_id, price_cents, currency")
      .eq("event_id", eventId)
      .order("created_at"),
    supabase.from("divisions").select("id, name").eq("event_id", eventId),
  ]);

  if (!registros || registros.length === 0) return [];

  const [{ data: integrantes }, { data: equipos }] = await Promise.all([
    supabase
      .from("registration_members")
      .select(
        "registration_id, first_name, last_name, invited_email, status, position, accepted_terms_at",
      )
      .eq("event_id", eventId)
      .order("position"),
    supabase.from("teams").select("id, bib_number").eq("event_id", eventId),
  ]);

  const nombreDivision = new Map((divisiones ?? []).map((d) => [d.id, d.name]));
  const dorsal = new Map((equipos ?? []).map((t) => [t.id, t.bib_number]));
  const readiness = await getReadinessEnLote(supabase, registros.map((r) => r.id));

  return registros.map((r) => ({
    id: r.id,
    status: r.status,
    teamName: r.team_name,
    divisionName: nombreDivision.get(r.division_id) ?? "",
    bib: r.team_id ? (dorsal.get(r.team_id) ?? null) : null,
    priceCents: r.price_cents,
    currency: r.currency,
    readiness: readiness.get(r.id) ?? "incompleto",
    integrantes: (integrantes ?? [])
      .filter((m) => m.registration_id === r.id)
      .map((m) => ({
        nombre: [m.first_name, m.last_name].filter(Boolean).join(" "),
        email: m.invited_email,
        completo: m.status === "completo",
        aceptoTerminos: m.accepted_terms_at !== null,
      })),
  }));
}
