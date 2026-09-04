import Link from "next/link";
import {
  setEventStatus,
  type FormState,
} from "@/features/events/config/actions";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import {
  getConfigIssues,
  getCourseTemplates,
  getDivisions,
  getHeats,
  getPenaltyTypes,
  getTeams,
} from "@/features/events/config/queries";
import { getPruebas } from "@/features/workouts/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import { BotonPublicar } from "@/features/events/components/BotonPublicar";
import { getEstadoDelPlan } from "@/features/planes/queries";
import { AvisoDePlan } from "@/features/planes/components/AvisoDePlan";
import { Icono } from "@/shared/components/Icono";

/**
 * "Resumen" (la pestaña de produccion) y "Config Competencia" (la barra
 * lateral) son la MISMA pantalla. Antes eran dos: una con el listado
 * (Divisiones, Circuito/Workouts, Atletas, Heats, Penalizaciones) en
 * `/configuracion` sin pestañas, y esta con "Revisar antes de iniciar" y
 * "Estado de la competencia". La misma competencia se le explicaba al
 * organizador en dos lugares distintos segun por donde entrara.
 *
 * Ahora es UNA sola pagina, con las pestañas de produccion arriba (Resumen,
 * Heats, Cargar) porque sigue siendo la primera de esas tres, y la barra
 * lateral apunta ACA MISMO (`/panel/eventos/[id]`, sin sufijo) en vez de a una
 * ruta separada. La ruta `/configuracion` ya no existe.
 *
 * Sigue siendo UNICA Y EXCLUSIVAMENTE sobre esta competencia: nunca va a
 * mostrar Inscripciones, Colaboradores ni Informacion General, que tienen su
 * propio lugar en el menu.
 */
export default async function ResumenPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event, canManage } = await requireEventAccess(id);

  const [templates, divisions, pruebas, penalties, teams, heats, issues, plan] =
    await Promise.all([
      getCourseTemplates(id),
      getDivisions(id),
      getPruebas(id),
      getPenaltyTypes(id),
      getTeams(id),
      getHeats(id),
      getConfigIssues(id),
      getEstadoDelPlan(id),
    ]);

  const esHibrida = event.format !== "crossfit";
  const errores = issues.filter((i) => i.severity === "error");
  const avisos = issues.filter((i) => i.severity === "warning");

  // UNA sola lista para las dos cosas: lo que se RENDERIZA (el check, el link,
  // la cuenta) y lo que decide si "Marcar como lista" se habilita. Antes eran
  // dos arreglos paralelos —uno para la grilla de tarjetas, otro solo para el
  // calculo— y nada garantizaba que dijeran lo mismo.
  //
  // El orden es fijo: Divisiones, Circuito o Workouts segun el formato,
  // Atletas, Heats, Penalizaciones. Circuito y Workouts son EXCLUYENTES —nunca
  // los dos a la vez— porque una carrera hibrida no corre workouts sueltos y
  // un CrossFit no arma un circuito.
  //
  // `opcional` marca lo que conviene tener pero no impide largar. Una
  // competencia sin catalogo de penalizaciones es perfectamente valida, y
  // bloquear la largada por eso solo deja al organizador tocando un boton
  // deshabilitado sin saber por que. Workouts tambien queda opcional por ahora:
  // nunca bloqueo la largada de un CrossFit y no es esta pantalla la que tiene
  // que empezar a exigirlo.
  const secciones: Array<{
    href: string;
    titulo: string;
    cuenta: string;
    hecho: boolean;
    opcional: boolean;
  }> = [
    {
      href: `/panel/eventos/${id}/divisiones`,
      titulo: "Categorías",
      cuenta: `${divisions.length} categoría(s)`,
      hecho: divisions.length > 0,
      opcional: false,
    },
    esHibrida
      ? {
          href: `/panel/eventos/${id}/circuito`,
          titulo: "Circuito",
          cuenta: `${templates.length} plantilla(s)`,
          hecho: templates.length > 0,
          opcional: false,
        }
      : {
          href: `/panel/eventos/${id}/pruebas`,
          titulo: "Workouts",
          cuenta: `${pruebas.length} workout(s)`,
          hecho: pruebas.length > 0,
          opcional: true,
        },
    {
      href: `/panel/eventos/${id}/atletas`,
      titulo: "Atletas",
      cuenta: `${teams.length} equipo(s)`,
      hecho: teams.length > 0,
      opcional: false,
    },
    {
      href: `/panel/eventos/${id}/heats`,
      titulo: "Heats",
      cuenta: `${heats.length} heat(s)`,
      hecho: heats.length > 0,
      opcional: false,
    },
    {
      href: `/panel/eventos/${id}/penalizaciones`,
      titulo: "Penalizaciones",
      cuenta: `${penalties.length} tipo(s)`,
      hecho: penalties.length > 0,
      opcional: true,
    },
  ];

  const carrilesConAtleta = heats.reduce(
    (n, h) => n + h.lanes.filter((l) => l.team_id !== null).length,
    0,
  );

  const faltantes = [
    ...secciones
      .filter((s) => !s.opcional && !s.hecho)
      .map((s) => s.titulo.toLowerCase()),
    // Un heat sin equipos asignados no le sirve a ningun juez.
    ...(heats.length > 0 && carrilesConAtleta === 0
      ? ["equipos asignados a los carriles"]
      : []),
  ];

  const completo = faltantes.length === 0 && errores.length === 0;

  // Los mismos estados que expone public_event_info(). Fuera de estos, las
  // pantallas publicas devuelven 404 a proposito.
  // En el plan gratuito el leaderboard recien existe con los resultados
  // oficiales publicados: `public_scoreboard` no devuelve nada antes. Un link
  // activo en vivo llevaria a una pantalla vacia.
  const esPublico =
    plan?.muestraEnVivo === false
      ? event.status === "published"
      : ["live", "verifying", "published"].includes(event.status);

  return (
    <div className="flex flex-col gap-6">
      {/* La lista con el check verde: de un vistazo dice que esta cargado y
          que no, y CADA FILA ES UN LINK a la seccion o pestaña que lo
          configura — es lo que la version en tarjetas no dejaba hacer tan
          directo. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-widest text-neutral-500 uppercase">
          Configuración
        </h2>
        <ul className="flex flex-col gap-2">
          {secciones.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="flex items-center justify-between rounded-2xl border border-neutral-800 p-4 transition-colors hover:border-neutral-700"
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      s.hecho
                        ? "bg-lime-400 text-lime-950"
                        : "bg-neutral-800 text-neutral-500"
                    }`}
                  >
                    {s.hecho ? (
                      <Icono
                        nombre="tilde"
                        className="h-3.5 w-3.5"
                        grosor={3}
                      />
                    ) : (
                      "·"
                    )}
                  </span>
                  {s.hecho && <span className="sr-only">Completado: </span>}
                  <span className="font-medium">
                    {s.titulo}
                    {s.opcional && (
                      <span className="ml-2 text-xs font-normal text-neutral-600">
                        opcional
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-sm text-neutral-500">{s.cuenta}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* "Revisar antes de iniciar" complementa la lista de arriba: el check
          dice SI hay divisiones cargadas, esto dice que hay una division
          concreta sin equipos inscriptos — un detalle que ningun check
          resume. */}
      {issues.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-widest text-neutral-500 uppercase">
            Revisar antes de iniciar
          </h2>
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
        </section>
      )}

      {canManage && (
        <section className="rounded-2xl border border-neutral-800 p-5">
          <h2 className="font-semibold">Estado de la competencia</h2>
          <p className="mt-1 text-sm text-neutral-500">
            {event.status === "draft" &&
              (completo
                ? "Está todo cargado. Pásala a Lista y después a En vivo para que los jueces vean sus carriles."
                : `Falta: ${[...faltantes, ...(errores.length > 0 ? [`resolver ${errores.length} error(es)`] : [])].join(", ")}.`)}
            {event.status === "ready" &&
              "Lista para iniciar. Pásala a En vivo el día del evento."}
            {event.status === "live" &&
              "En vivo. El leaderboard público muestra tiempos NO oficiales."}
            {event.status === "verifying" &&
              "Revisando resultados antes de publicar."}
            {event.status === "published" && "Resultados oficiales publicados."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {event.status === "draft" && (
              <FormularioDeEstado
                accion={marcarListo.bind(null, id)}
                estadoInicial={{ error: null }}
                etiqueta="Marcar como lista"
                mensajeDeCarga="Marcando la competencia como lista…"
                disabled={!completo}
                className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950 disabled:cursor-not-allowed disabled:opacity-40"
              />
            )}
            {event.status === "ready" && (
              <>
                <FormularioDeEstado
                  accion={marcarEnVivo.bind(null, id)}
                  estadoInicial={{ error: null }}
                  etiqueta="Poner en vivo"
                  mensajeDeCarga="Poniendo la competencia en vivo…"
                  className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950"
                />
                <FormularioDeEstado
                  accion={volverABorrador.bind(null, id)}
                  estadoInicial={{ error: null }}
                  etiqueta="Volver a borrador"
                  mensajeDeCarga="Volviendo a borrador…"
                  className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-400"
                />
              </>
            )}
          </div>

          <div className="mt-5 border-t border-neutral-800 pt-4">
            <p className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">
              Catálogo público
            </p>
            {/*
              Publicar es independiente del estado: una competencia interna
              corre entera sin aparecer nunca en el catalogo, y una publicada
              aparece desde que se anuncia, mucho antes de largar.
            */}
            <div className="mt-3 flex flex-col gap-3">
              {plan?.puedePublicar === false ? (
                <AvisoDePlan estado={plan} motivo="publicar" />
              ) : (
                <BotonPublicar
                  eventId={id}
                  publicado={event.published_at !== null}
                  slug={event.public_slug}
                />
              )}
            </div>
          </div>

          {event.status !== "draft" && (
            <div className="mt-5 border-t border-neutral-800 pt-4">
              <p className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">
                Pantallas públicas
              </p>

              {/*
                Los links solo se activan cuando las paginas publicas realmente
                responden. En estado "lista" el evento todavia no es publico
                —public_event_info lo oculta a proposito, para no filtrar la
                grilla antes de que la organizacion la anuncie— asi que un link
                activo ahi lleva a un 404.
              */}
              <div className="mt-2 flex flex-wrap gap-2">
                {esPublico ? (
                  <>
                    <Link
                      href={`/en-vivo/${event.public_slug}`}
                      className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
                    >
                      Leaderboard
                    </Link>
                    <Link
                      href={`/en-vivo/${event.public_slug}/proyector`}
                      className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
                    >
                      Proyector
                    </Link>
                  </>
                ) : (
                  <>
                    <span className="cursor-not-allowed rounded-xl border border-neutral-800 px-4 py-2 text-sm text-neutral-600">
                      Leaderboard
                    </span>
                    <span className="cursor-not-allowed rounded-xl border border-neutral-800 px-4 py-2 text-sm text-neutral-600">
                      Proyector
                    </span>
                    <p className="w-full text-xs text-amber-400">
                      {plan?.muestraEnVivo === false
                        ? "Se activan cuando publiques los resultados oficiales."
                        : "Se activan cuando pongas la competencia en vivo."}
                    </p>
                  </>
                )}
              </div>
              {plan?.muestraEnVivo === false && (
                <div className="mt-3">
                  <AvisoDePlan estado={plan} motivo="resultados" />
                </div>
              )}
              <p className="mt-3 text-xs text-neutral-600">
                Link para los atletas:{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5">
                  /en-vivo/{event.public_slug}/atleta/&lt;dorsal&gt;
                </code>
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Los bind() de arriba necesitan funciones de servidor con el eventId ya
// atado y, ahora, la firma `(prevState, formData) => FormState` que pide
// `useActionState` dentro de `FormularioDeEstado` — el eventId se fija con
// `.bind`, los otros dos parametros los pone React al llamarla.
async function marcarListo(
  eventId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return setEventStatus(eventId, "ready");
}

async function marcarEnVivo(
  eventId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return setEventStatus(eventId, "live");
}

async function volverABorrador(
  eventId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return setEventStatus(eventId, "draft");
}
