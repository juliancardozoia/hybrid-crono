import Link from "next/link";
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
import {
  getInscripcionesDelEvento,
  getMisInscripciones,
} from "@/features/inscripciones/queries";
import {
  textoDeEstado,
  claseDePastilla,
  mensajeDeReadiness,
} from "@/features/inscripciones/lib/estados";
import { getPerfil } from "@/features/cuenta/queries";
import { puedeJuzgar, getJudgeLanes } from "@/features/judge/queries";
import { getLeaderboard } from "@/features/leaderboard/queries";
import { rangoDeFechas } from "@/features/catalogo/lib/formato";
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
 * El inicio de siempre: Compito y Juzgo. Es lo que ve cualquier cuenta sin
 * ninguna competencia propia -- un atleta puro, o un organizador que
 * todavia no creo la primera.
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

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 p-6 lg:p-10">
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

      {/* COMPITO. Siempre visible, aunque este vacia: un selector ausente no
          dice nada, uno vacio invita a buscar una competencia. */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Compito</h2>
          <Link href="/" className="text-sm text-lime-400 hover:underline">
            Buscar competencias
          </Link>
        </div>

        {inscripciones.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-800 p-10 text-center">
            <p className="text-neutral-400">Todavía no te inscribiste en ninguna.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {inscripciones.map((i) => {
              // "PAGADO no significa LISTO": una vez confirmada, este
              // mensaje es lo que distingue "ya pagaste, pero..." de "no
              // falta nada". Antes de confirmarse, el badge de status ya
              // cuenta toda la historia ("falta pagar", "faltan
              // integrantes") y esto no agrega nada nuevo.
              const mensaje = mensajeDeReadiness(i.status, i.readiness);
              return (
                <li
                  key={i.id}
                  className="flex flex-col gap-2 rounded-2xl border border-neutral-800 p-4 transition-colors hover:border-neutral-700 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <Link href={`/inscripcion/${i.id}`} className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{i.eventName}</p>
                    <p className="truncate text-sm text-neutral-500">
                      {[i.divisionName, rangoDeFechas(i.startsAt, null, i.timezone, idioma, "")]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {mensaje && (
                      <p
                        className={`mt-1 text-sm font-medium ${
                          i.readiness === "listo" ? "text-lime-400" : "text-amber-400"
                        }`}
                      >
                        {i.readiness === "listo" ? "✓ " : "○ "}
                        {mensaje}
                      </p>
                    )}
                  </Link>
                  <div className="flex shrink-0 items-center gap-3">
                    {i.bib !== null && (
                      <Link
                        href={`/en-vivo/${i.eventSlug}/atleta/${i.bib}`}
                        className="text-sm font-medium text-lime-400 hover:underline"
                      >
                        Ver resultados
                      </Link>
                    )}
                    {i.status === "esperando_pago" && (
                      <Link
                        href={`/inscripcion/${i.id}`}
                        className="text-sm font-medium text-lime-400 hover:underline"
                      >
                        Completar pago
                      </Link>
                    )}
                    {i.status === "confirmada" && i.readiness === "accion_requerida" && (
                      <Link
                        href={`/inscripcion/${i.id}`}
                        className="text-sm font-medium text-amber-400 hover:underline"
                      >
                        Completar mi inscripción
                      </Link>
                    )}
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${claseDePastilla(i.status)}`}
                    >
                      {textoDeEstado(i.status)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
