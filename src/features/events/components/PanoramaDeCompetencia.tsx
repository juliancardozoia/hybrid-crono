import Link from "next/link";
import { ModoDeCaptura } from "@/features/workouts/components/ModoDeCaptura";
import { MenuDeAccionesDeCompetencia } from "./MenuDeAccionesDeCompetencia";
import { EstadoBadge } from "./EstadoBadge";
import { AvisoDePlan } from "@/features/planes/components/AvisoDePlan";
import type { EstadoDelPlan } from "@/features/planes/queries";
import { textoDeEstado } from "@/features/inscripciones/lib/estados";
import type { FilaDeInscripcion } from "@/features/inscripciones/queries";
import { LeaderboardLive } from "@/features/leaderboard/components/LeaderboardLive";
import type { Leaderboard } from "@/features/leaderboard/queries";
import { rangoDeFechas } from "@/features/catalogo/lib/formato";
import type { Idioma } from "@/shared/i18n/idiomas";
import { Icono } from "@/shared/components/Icono";
import type {
  CourseTemplate,
  DivisionRow,
  EventRow,
  PenaltyType,
  RegistrationStatus,
} from "@/lib/supabase/types";
import type { HeatWithLanes, TeamWithMembers } from "@/features/events/config/queries";
import type { ConfigIssue } from "@/lib/supabase/types";
import type { PruebaConPartes } from "@/features/workouts/queries";
import type { CaptureMode } from "@/lib/supabase/types";

/**
 * El panorama de UNA competencia: la tarjeta con afiche + informacion
 * general, la configuracion pendiente plegada, y la fila de tarjetas de
 * estado (leaderboard en vivo, inscripciones sin confirmar). Es un
 * componente PRESENTACIONAL puro -- recibe todo ya resuelto, no hace ninguna
 * consulta -- porque lo usa `/panel` (el inicio, para la competencia que
 * corresponda segun `competenciaActualId()`), y en algun momento puede volver
 * a hacer falta en otro lugar.
 *
 * Vivio antes en `/panel/eventos/[id]` (la pestaña "Resumen"). Se movio al
 * inicio del panel a proposito: es el primer lugar donde alguien quiere
 * pararse a mirar "como viene esto", no una pestaña mas entre Divisiones y
 * Heats. Esa ruta ahora solo marca la competencia como la actual y redirige
 * aca -- ver `elegirCompetencia()` en `src/features/panel/actions.ts`.
 */
export function PanoramaDeCompetencia({
  eventId,
  event,
  canManage,
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
  idioma,
}: {
  eventId: string;
  event: EventRow;
  canManage: boolean;
  templates: CourseTemplate[];
  divisions: DivisionRow[];
  pruebas: PruebaConPartes[];
  penalties: PenaltyType[];
  teams: TeamWithMembers[];
  heats: HeatWithLanes[];
  issues: ConfigIssue[];
  plan: EstadoDelPlan | null;
  inscripciones: FilaDeInscripcion[];
  leaderboard: Leaderboard;
  idioma: Idioma;
}) {
  const esHibrida = event.format !== "crossfit";
  const errores = issues.filter((i) => i.severity === "error");
  const avisos = issues.filter((i) => i.severity === "warning");

  // UNA sola lista para las dos cosas: lo que se RENDERIZA (el check, el link,
  // la cuenta) y lo que decide si "Marcar como lista" se habilita. El orden es
  // fijo: Divisiones, Circuito o Workouts segun el formato, Atletas, Heats,
  // Penalizaciones. Circuito y Workouts son EXCLUYENTES.
  const secciones: Array<{
    href: string;
    titulo: string;
    cuenta: string;
    hecho: boolean;
    opcional: boolean;
  }> = [
    {
      href: `/panel/eventos/${eventId}/divisiones`,
      titulo: "Categorías",
      cuenta: `${divisions.length} categoría(s)`,
      hecho: divisions.length > 0,
      opcional: false,
    },
    esHibrida
      ? {
          href: `/panel/eventos/${eventId}/circuito`,
          titulo: "Circuito",
          cuenta: `${templates.length} plantilla(s)`,
          hecho: templates.length > 0,
          opcional: false,
        }
      : {
          href: `/panel/eventos/${eventId}/pruebas`,
          titulo: "Workouts",
          cuenta: `${pruebas.length} workout(s)`,
          hecho: pruebas.length > 0,
          opcional: false,
        },
    {
      href: `/panel/eventos/${eventId}/atletas`,
      titulo: "Atletas",
      cuenta: `${teams.length} equipo(s)`,
      hecho: teams.length > 0,
      opcional: false,
    },
    {
      href: `/panel/eventos/${eventId}/heats`,
      titulo: "Heats",
      cuenta: `${heats.length} heat(s)`,
      hecho: heats.length > 0,
      opcional: false,
    },
    {
      href: `/panel/eventos/${eventId}/penalizaciones`,
      titulo: "Penalizaciones",
      cuenta: `${penalties.length} tipo(s)`,
      hecho: penalties.length > 0,
      opcional: true,
    },
  ];

  const partesJuzgables = pruebas
    .flatMap((p) => p.parts)
    .filter((p) => p.time_scheme !== "circuito");
  const modoDeCapturaActual: CaptureMode = partesJuzgables.some(
    (p) => p.capture_mode === "en_vivo",
  )
    ? "en_vivo"
    : "manual";

  const carrilesConAtleta = heats.reduce(
    (n, h) => n + h.lanes.filter((l) => l.team_id !== null).length,
    0,
  );

  const faltantes = [
    ...secciones
      .filter((s) => !s.opcional && !s.hecho)
      .map((s) => s.titulo.toLowerCase()),
    ...(heats.length > 0 && carrilesConAtleta === 0
      ? ["equipos asignados a los carriles"]
      : []),
  ];

  const completo = faltantes.length === 0 && errores.length === 0;
  const pendientesDeConfig = faltantes.length + errores.length;

  // Los mismos estados que expone public_event_info(). Fuera de estos, las
  // pantallas publicas devuelven 404 a proposito.
  const esPublico =
    plan?.muestraEnVivo === false
      ? event.status === "published"
      : ["live", "verifying", "published"].includes(event.status);

  // El detalle de que falta (secciones sin cargar, errores por resolver) vive
  // en "Recomendaciones", no aca: repetirlo en la cabecera hacia que el
  // primer vistazo a la competencia fuera una lista de pendientes en vez de
  // su estado.
  const faltaTexto = [
    ...faltantes,
    ...(errores.length > 0 ? [`resolver ${errores.length} error(es)`] : []),
  ].join(", ");

  const mensajeDeEstado =
    event.status === "draft"
      ? completo
        ? "Está todo cargado. Pásala a Lista y después a En vivo para que los jueces vean sus carriles."
        : "Todavía falta cargar configuración — mirá las recomendaciones más abajo."
      : event.status === "ready"
        ? "Lista para iniciar. Pásala a En vivo el día del evento."
        : event.status === "live"
          ? "En vivo. El leaderboard público muestra tiempos NO oficiales."
          : event.status === "verifying"
            ? "Revisando resultados antes de publicar."
            : "Resultados oficiales publicados.";

  // "Sin confirmar": inscripciones que todavia no llegaron a `confirmada` (y
  // no se cancelaron). Es el mismo dato que ya responde la pestaña
  // Inscripciones, resumido en un numero para no tener que entrar a mirarlo.
  const pendientesDeInscripcion = inscripciones.filter(
    (r) => r.status !== "confirmada" && r.status !== "cancelada",
  );
  const ORDEN_PENDIENTES: RegistrationStatus[] = [
    "esperando_pago",
    "esperando_integrantes",
    "borrador",
    "lista_espera",
  ];
  const conteoPorEstado = new Map<RegistrationStatus, number>();
  for (const r of pendientesDeInscripcion) {
    conteoPorEstado.set(r.status, (conteoPorEstado.get(r.status) ?? 0) + 1);
  }
  const equiposSinAprobar = teams.filter((t) => !t.approved).length;

  return (
    <div className="flex flex-col gap-6">
      {/* El panorama: afiche + informacion general, con las acciones sobre
          la competencia agrupadas en el menu de "...". */}
      <section className="rounded-2xl border border-neutral-800 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold tracking-tight text-neutral-50">
              {event.name}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">{mensajeDeEstado}</p>
          </div>
          {canManage && (
            <MenuDeAccionesDeCompetencia
              eventId={eventId}
              status={event.status}
              completo={completo}
              publicado={event.published_at !== null}
              puedePublicar={plan?.puedePublicar !== false}
            />
          )}
        </div>

        <div className="mt-5 flex flex-col gap-6 lg:flex-row">
          <div className="aspect-square w-full shrink-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 lg:w-64">
            {event.logo_url ? (
              // Imagen de Storage: <img> y no next/image, que exigiria
              // declarar el host en la configuracion.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.logo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-neutral-600">
                Sin afiche cargado
              </div>
            )}
          </div>

          <dl className="grid flex-1 grid-cols-1 content-start gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fila etiqueta="Estado">
              <EstadoBadge status={event.status} />
            </Fila>
            <Fila etiqueta="Formato">
              {esHibrida ? "Carrera híbrida (HYROX)" : "CrossFit"}
            </Fila>
            <Fila etiqueta="Fecha">
              {rangoDeFechas(event.starts_at ?? event.event_date, event.ends_at, event.timezone, idioma)}
            </Fila>
            <Fila etiqueta="Sede">
              {[event.venue, event.city].filter(Boolean).join(", ") || "Sin definir"}
            </Fila>
            <Fila etiqueta="Ficha pública">
              {event.published_at ? (
                <a
                  href={`/eventos/${event.public_slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-lime-400 hover:underline"
                >
                  Ver ficha pública →
                </a>
              ) : (
                <span className="text-neutral-600">Sin publicar</span>
              )}
            </Fila>
            <Fila etiqueta="Pantallas públicas">
              {esPublico ? (
                <Link
                  href={`/en-vivo/${event.public_slug}/proyector`}
                  className="text-lime-400 hover:underline"
                >
                  Proyector →
                </Link>
              ) : (
                <span className="text-neutral-600">
                  {plan?.muestraEnVivo === false
                    ? "Se activan al publicar los oficiales"
                    : "Se activan al poner en vivo"}
                </span>
              )}
            </Fila>
          </dl>
        </div>

        {/* "Como se juzgan las pruebas" vive ACA, ocupando el ancho entero
            de la tarjeta -- antes era una seccion propia mas abajo. Los
            botones van PRIMERO: son la decision, el parrafo de abajo es
            solo la aclaracion de que aplica a toda la competencia. */}
        {canManage && partesJuzgables.length > 0 && (
          <div className="mt-5 border-t border-neutral-800 pt-4">
            <h3 className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">
              Cómo se juzgan las pruebas
            </h3>
            <div className="mt-3">
              <ModoDeCaptura
                eventId={eventId}
                actual={modoDeCapturaActual}
                bloqueado={plan ? !plan.puedeJuzgarEnVivo : false}
              />
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              Aplica a TODAS las pruebas de esta competencia, no a una en particular — es una
              capacidad que se contrata para todo el evento.
            </p>
          </div>
        )}
      </section>

      {canManage && (plan?.puedePublicar === false || (plan?.muestraEnVivo === false && event.status !== "draft")) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {plan?.puedePublicar === false && <AvisoDePlan estado={plan} motivo="publicar" />}
          {plan?.muestraEnVivo === false && event.status !== "draft" && (
            <AvisoDePlan estado={plan} motivo="resultados" />
          )}
        </div>
      )}

      {/* Recomendaciones: el detalle de que falta y los avisos de
          `getConfigIssues`, plegados. El checklist de secciones (Categorias,
          Atletas, Heats...) ya NO vive aca -- se mudo a la tarjeta
          "Configuración" de mas abajo, siempre visible. Esto queda para lo
          que de verdad necesita leerse una vez y despues no molestar: por
          eso arranca SIEMPRE cerrado, incluso con pendientes -- el badge ya
          avisa que hay algo, sin obligar a verlo cada vez que se entra. */}
      <details className="group rounded-2xl border border-neutral-800">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 select-none">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-widest text-neutral-500 uppercase">
            <Icono
              nombre="flecha"
              className="h-3 w-3 shrink-0 text-neutral-600 transition-transform group-open:rotate-90"
            />
            Recomendaciones
          </span>
          {completo ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-lime-400">
              <Icono nombre="tilde" className="h-3.5 w-3.5" grosor={3} />
              Todo listo
            </span>
          ) : (
            <span className="shrink-0 text-xs font-medium text-amber-400">
              {pendientesDeConfig} pendiente{pendientesDeConfig === 1 ? "" : "s"}
            </span>
          )}
        </summary>

        <div className="flex flex-col gap-4 px-5 pb-5">
          {!completo && <p className="text-sm text-neutral-400">Falta: {faltaTexto}.</p>}

          {issues.length > 0 && (
            <ul className="flex flex-col gap-2">
              {[...errores, ...avisos].map((issue, i) => (
                <li
                  key={`${issue.code}-${i}`}
                  className={`rounded-xl border p-3 text-sm ${
                    issue.severity === "error"
                      ? "border-red-500/40 bg-red-500/10 text-red-200"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  }`}
                >
                  {issue.detail}
                </li>
              ))}
            </ul>
          )}

          {completo && issues.length === 0 && (
            <p className="text-sm text-neutral-500">No hay nada pendiente por ahora.</p>
          )}
        </div>
      </details>

      {/* El panorama en tarjetas: lo que se estira solo sin tener que entrar
          a otra pestaña. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-neutral-800 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-widest text-neutral-500 uppercase">
              Leaderboard
            </h3>
            <Link
              href={`/panel/eventos/${eventId}/leaderboard`}
              className="shrink-0 text-xs text-lime-400 hover:underline"
            >
              Ver todo →
            </Link>
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto">
            {leaderboard.rows.length > 0 ? (
              <LeaderboardLive
                slug={event.public_slug}
                inicial={leaderboard}
                eventName={event.name}
                compacto
              />
            ) : (
              <p className="py-6 text-center text-xs text-neutral-600">
                Todavía no hay resultados.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-neutral-800 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-widest text-neutral-500 uppercase">
              Sin confirmar
            </h3>
            <Link
              href={`/panel/eventos/${eventId}/inscripciones`}
              className="shrink-0 text-xs text-lime-400 hover:underline"
            >
              Ver →
            </Link>
          </div>

          <p className="mt-3 text-3xl font-bold tabular-nums">
            {pendientesDeInscripcion.length}
          </p>
          <p className="text-xs text-neutral-500">
            {pendientesDeInscripcion.length === 1
              ? "inscripción pendiente"
              : "inscripciones pendientes"}
          </p>

          {pendientesDeInscripcion.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5 text-sm text-neutral-400">
              {ORDEN_PENDIENTES.filter((s) => (conteoPorEstado.get(s) ?? 0) > 0).map((s) => (
                <li key={s} className="flex items-center justify-between gap-2">
                  <span>{textoDeEstado(s)}</span>
                  <span className="tabular-nums text-neutral-500">{conteoPorEstado.get(s)}</span>
                </li>
              ))}
            </ul>
          )}

          {equiposSinAprobar > 0 && (
            <p className="mt-4 border-t border-neutral-800 pt-3 text-xs text-amber-400">
              {equiposSinAprobar} equipo{equiposSinAprobar === 1 ? "" : "s"} sin aprobar
            </p>
          )}

          {pendientesDeInscripcion.length === 0 && equiposSinAprobar === 0 && (
            <p className="mt-4 text-xs text-neutral-600">
              Todas las inscripciones están confirmadas.
            </p>
          )}
        </div>

        {/* Configuración: el checklist de secciones (Categorias,
            Circuito/Workouts, Atletas, Heats, Penalizaciones), mudado aca
            desde "Recomendaciones" -- es lo que se toca seguido mientras se
            arma la competencia, no algo para leer una vez y plegar. */}
        <div className="rounded-2xl border border-neutral-800 p-5">
          <h3 className="text-sm font-semibold tracking-widest text-neutral-500 uppercase">
            Configuración
          </h3>
          <ul className="mt-3 flex flex-col gap-1">
            {secciones.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-neutral-900"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        s.hecho
                          ? "bg-lime-400 text-lime-950"
                          : "bg-neutral-800 text-neutral-500"
                      }`}
                    >
                      {s.hecho ? (
                        <Icono nombre="tilde" className="h-3 w-3" grosor={3} />
                      ) : (
                        "·"
                      )}
                    </span>
                    {s.hecho && <span className="sr-only">Completado: </span>}
                    <span className="truncate">
                      {s.titulo}
                      {s.opcional && (
                        <span className="ml-1.5 text-xs font-normal text-neutral-600">
                          opcional
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-neutral-500">{s.cuenta}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-neutral-600">{etiqueta}</dt>
      <dd className="mt-0.5 truncate text-sm text-neutral-200">{children}</dd>
    </div>
  );
}
