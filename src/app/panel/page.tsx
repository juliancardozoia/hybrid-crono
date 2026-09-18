import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEventAccess, type EventAccess } from "@/features/events/lib/access";
import { listEventosQueOrganizo } from "@/features/events/queries";
import {
  competenciaActualId,
  resolverCompetenciaActualId,
} from "@/features/panel/lib/competenciaActual";
import {
  getConfigIssues,
  getCourseTemplates,
  getDivisions,
  getHeats,
  getPenaltyTypes,
  getTeams,
} from "@/features/events/config/queries";
import { getPruebas } from "@/features/workouts/queries";
import { getEstadoDelPlan } from "@/features/planes/queries";
import { PanoramaDeCompetencia } from "@/features/events/components/PanoramaDeCompetencia";
import { PanoramaDeAtleta } from "@/features/inscripciones/components/PanoramaDeAtleta";
import {
  getInscripcionesDelEvento,
  getMisInscripciones,
} from "@/features/inscripciones/queries";
import { elegirDestacada } from "@/features/inscripciones/lib/panorama";
import { getPerfil } from "@/features/cuenta/queries";
import { puedeJuzgar, getJudgeLanes } from "@/features/judge/queries";
import {
  getLeaderboard,
  getResultadoDeAtleta,
  type Leaderboard,
  type ResultadoDeAtleta,
} from "@/features/leaderboard/queries";
import { traduccion } from "@/shared/i18n/servidor";
import { Icono } from "@/shared/components/Icono";

export const metadata = { title: "Panel — Scora" };

/**
 * El inicio de cualquier cuenta -- y, desde este cambio, tambien el
 * panorama de la competencia que el organizador tiene abierta.
 *
 * ANTES el panorama (afiche, estado, checklist, leaderboard, inscripciones
 * sin confirmar) vivia en `/panel/eventos/[id]`, la pestaña "Resumen" de
 * CADA competencia. Se corrigio ACA: es el inicio de la cuenta, el primer
 * lugar donde alguien se para a mirar "como viene esto" -- no una pestaña
 * mas entre Divisiones y Heats. `/panel/eventos/[id]` ahora es solo un
 * GATE que marca esa competencia como la actual y redirige para aca (ver
 * `elegirCompetencia()`); el selector del header hace lo mismo al elegir una.
 *
 * QUE COMPETENCIA SE MUESTRA cuando el organizador tiene mas de una: la que
 * dice la cookie `competencia_actual` (lo ultimo que eligio, en el selector o
 * entrando por cualquier pestaña de una competencia puntual), y si no hay
 * cookie vigente, la mas reciente de `listEventosQueOrganizo()`. Ver
 * `resolverCompetenciaActualId()`.
 *
 * SIN NINGUNA COMPETENCIA PROPIA (un atleta puro, o un organizador que
 * todavia no creo la primera) esta pantalla vuelve a lo de siempre: las
 * secciones "Compito" y "Juzgo". Que pasa con esas dos secciones para quien
 * SI tiene una competencia abierta es algo que queda para otra vuelta --
 * por ahora, el panorama de la competencia reemplaza al resto.
 */
export default async function PanelPage() {
  const [cookieCompetencia, organizadas] = await Promise.all([
    competenciaActualId(),
    listEventosQueOrganizo(),
  ]);
  const idCompetenciaActual = resolverCompetenciaActualId(organizadas, cookieCompetencia);

  if (idCompetenciaActual) {
    const acceso = await getEventAccess(idCompetenciaActual);
    // La cookie puede apuntar a una competencia borrada, o a la que el
    // usuario perdio acceso entre visitas: si `getEventAccess` no la
    // reconoce, cae al inicio de siempre en vez de romper la pantalla.
    if (acceso) return <PanelDeCompetencia eventId={idCompetenciaActual} acceso={acceso} />;
  }

  return <PanelDeCuenta />;
}

async function PanelDeCompetencia({
  eventId,
  acceso,
}: {
  eventId: string;
  acceso: EventAccess;
}) {
  const { event, canManage } = acceso;

  const [
    templates,
    divisions,
    pruebas,
    penalties,
    teams,
    heats,
    issues,
    plan,
    inscripciones,
    leaderboard,
    { idioma },
  ] = await Promise.all([
    getCourseTemplates(eventId),
    getDivisions(eventId),
    getPruebas(eventId),
    getPenaltyTypes(eventId),
    getTeams(eventId),
    getHeats(eventId),
    getConfigIssues(eventId),
    getEstadoDelPlan(eventId),
    getInscripcionesDelEvento(eventId),
    // Mismo camino que la pestaña "Leaderboard": el RPC publico, sin cliente
    // autenticado. Vacio hasta que la competencia esta en vivo o publicada.
    getLeaderboard(event.public_slug),
    traduccion(),
  ]);

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-10">
      <PanoramaDeCompetencia
        eventId={eventId}
        event={event}
        canManage={canManage}
        templates={templates}
        divisions={divisions}
        pruebas={pruebas}
        penalties={penalties}
        teams={teams}
        heats={heats}
        issues={issues}
        plan={plan}
        inscripciones={inscripciones}
        leaderboard={leaderboard}
        idioma={idioma}
      />
    </main>
  );
}

/**
 * El inicio de siempre: mi panorama como atleta, y Juzgo. Es lo que ve
 * cualquier cuenta sin ninguna competencia propia -- un atleta puro, o un
 * organizador que todavia no creo la primera.
 *
 * "Compito" (la lista plana de inscripciones) se reemplazo por
 * `PanoramaDeAtleta`: mismo concepto que el panorama del organizador, del
 * otro lado -- un widget destacado con la competencia mas urgente (afiche,
 * cuenta regresiva, mi categoria, mi dorsal) mas sus resultados si ya los
 * hay, y debajo la lista completa de todas mis inscripciones con su estado.
 */
async function PanelDeCuenta() {
  const [perfil, { idioma }, inscripciones, mostrarJuzgar] = await Promise.all([
    getPerfil(),
    traduccion(),
    getMisInscripciones(),
    puedeJuzgar(),
  ]);

  const carrilesPropios = mostrarJuzgar ? (await getJudgeLanes()).mios : [];

  const perfilCompleto = Boolean(
    perfil && perfil.avatarUrl && perfil.phone && perfil.birthDate && perfil.country,
  );

  const destacada = elegirDestacada(inscripciones);

  // Cliente CON SESION, no el anonimo: el propio inscripto ve su resultado y
  // el de su categoria aunque el evento todavia no sea publico ni el plan
  // muestre nada en vivo -- el bypass vive en Postgres
  // (`puede_ver_resultados_propios`), mismo mecanismo que ya usa
  // `/en-vivo/[slug]/atleta/[bib]`. Es justo lo que pedia "habilitar los
  // resultados si el atleta esta en la competencia".
  let resultado: ResultadoDeAtleta = null;
  let leaderboardCircuito: Leaderboard | null = null;

  const puedeTenerResultados =
    destacada &&
    destacada.bib !== null &&
    ["live", "verifying", "published"].includes(destacada.eventStatus);

  if (puedeTenerResultados && destacada) {
    const supabase = await createClient();
    resultado = await getResultadoDeAtleta(destacada.eventSlug, destacada.bib!, supabase);
    if (destacada.eventFormat !== "crossfit") {
      leaderboardCircuito = await getLeaderboard(destacada.eventSlug, supabase);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 p-6 lg:p-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {`Hola, ${
            perfil?.fullName?.split(" ")[0] || perfil?.email.split("@")[0] || "de nuevo"
          }`}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Con esta misma cuenta compites, juzgas y organizas.
        </p>
      </div>

      {!perfilCompleto && (
        <Link
          href="/panel/perfil"
          className="flex items-center justify-between gap-4 rounded-2xl border border-lime-400/30 bg-lime-400/5 p-4 transition-colors hover:border-lime-400/50"
        >
          <p className="text-sm text-neutral-300">
            Te falta completar tu perfil —foto, teléfono, fecha de nacimiento, país—. Así tus
            próximas inscripciones ya vienen con tus datos cargados.
          </p>
          <span className="shrink-0 text-sm font-medium text-lime-400">Completar →</span>
        </Link>
      )}

      <PanoramaDeAtleta
        inscripciones={inscripciones}
        destacada={destacada}
        resultado={resultado}
        leaderboardCircuito={leaderboardCircuito}
        idioma={idioma}
      />

      {/* JUZGO. Solo si tiene algo que juzgar -- ver EncabezadoPublico, mismo gate. */}
      {mostrarJuzgar && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Juzgo</h2>
          <Link
            href="/juez"
            className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-800 p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/40"
          >
            <p className="text-sm text-neutral-300">
              {carrilesPropios.length > 0
                ? `Tenés ${carrilesPropios.length} carril${carrilesPropios.length === 1 ? "" : "es"} asignado${carrilesPropios.length === 1 ? "" : "s"}.`
                : "Elegí un carril para empezar a cronometrar."}
            </p>
            <Icono nombre="flecha" className="h-5 w-5 shrink-0 text-neutral-500" />
          </Link>
        </section>
      )}
    </main>
  );
}
