import Link from "next/link";
import { setEventStatus } from "@/features/events/config/actions";
import {
  getConfigIssues,
  getCourseTemplates,
  getDivisions,
  getHeats,
  getPenaltyTypes,
  getTeams,
} from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";

export default async function ResumenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, canManage } = await requireEventAccess(id);

  const [templates, divisions, penalties, teams, heats, issues] = await Promise.all([
    getCourseTemplates(id),
    getDivisions(id),
    getPenaltyTypes(id),
    getTeams(id),
    getHeats(id),
    getConfigIssues(id),
  ]);

  const errores = issues.filter((i) => i.severity === "error");
  const advertencias = issues.filter((i) => i.severity === "warning");

  // `opcional` marca lo que conviene tener pero no impide largar. Una
  // competencia sin catalogo de penalizaciones es perfectamente valida, y
  // bloquear la largada por eso solo deja al organizador tocando un boton
  // deshabilitado sin saber por que.
  const pasos = [
    { label: "Circuito", hecho: templates.length > 0, href: "circuito", detalle: `${templates.length} plantilla(s)` },
    { label: "Divisiones", hecho: divisions.length > 0, href: "divisiones", detalle: `${divisions.length} división(es)` },
    { label: "Penalizaciones", hecho: penalties.length > 0, href: "penalizaciones", detalle: `${penalties.length} tipo(s)`, opcional: true },
    { label: "Atletas", hecho: teams.length > 0, href: "atletas", detalle: `${teams.length} equipo(s)` },
    { label: "Heats", hecho: heats.length > 0, href: "heats", detalle: `${heats.length} heat(s)` },
  ];

  const carrilesConAtleta = heats.reduce(
    (n, h) => n + h.lanes.filter((l) => l.team_id !== null).length,
    0,
  );

  const faltantes = [
    ...pasos.filter((p) => !p.opcional && !p.hecho).map((p) => p.label.toLowerCase()),
    // Un heat sin equipos asignados no le sirve a ningun juez.
    ...(heats.length > 0 && carrilesConAtleta === 0 ? ["equipos asignados a los carriles"] : []),
  ];

  const completo = faltantes.length === 0 && errores.length === 0;

  // Los mismos estados que expone public_event_info(). Fuera de estos, las
  // pantallas publicas devuelven 404 a proposito.
  const esPublico = ["live", "verifying", "published"].includes(event.status);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-widest text-neutral-500 uppercase">
          Configuración
        </h2>
        <ul className="flex flex-col gap-2">
          {pasos.map((paso) => (
            <li key={paso.href}>
              <Link
                href={`/panel/eventos/${id}/${paso.href}`}
                className="flex items-center justify-between rounded-2xl border border-neutral-800 p-4 transition-colors hover:border-neutral-700"
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      paso.hecho ? "bg-lime-400 text-lime-950" : "bg-neutral-800 text-neutral-500"
                    }`}
                  >
                    {paso.hecho ? "✓" : "·"}
                  </span>
                  <span className="font-medium">
                    {paso.label}
                    {paso.opcional && (
                      <span className="ml-2 text-xs font-normal text-neutral-600">opcional</span>
                    )}
                  </span>
                </span>
                <span className="text-sm text-neutral-500">{paso.detalle}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {issues.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-widest text-neutral-500 uppercase">
            Revisar antes de iniciar
          </h2>
          <ul className="flex flex-col gap-2">
            {[...errores, ...advertencias].map((issue, i) => (
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
            {event.status === "ready" && "Lista para iniciar. Pásala a En vivo el día del evento."}
            {event.status === "live" &&
              "En vivo. El leaderboard público muestra tiempos NO oficiales."}
            {event.status === "verifying" && "Revisando resultados antes de publicar."}
            {event.status === "published" && "Resultados oficiales publicados."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {event.status === "draft" && (
              <form action={marcarListo.bind(null, id)}>
                <button
                  type="submit"
                  disabled={!completo}
                  className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Marcar como lista
                </button>
              </form>
            )}
            {event.status === "ready" && (
              <>
                <form action={marcarEnVivo.bind(null, id)}>
                  <button
                    type="submit"
                    className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950"
                  >
                    Poner en vivo
                  </button>
                </form>
                <form action={volverABorrador.bind(null, id)}>
                  <button
                    type="submit"
                    className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-400"
                  >
                    Volver a borrador
                  </button>
                </form>
              </>
            )}
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
                      Se activan cuando pongas la competencia en vivo.
                    </p>
                  </>
                )}
              </div>
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

// Los bind() de arriba necesitan funciones de servidor con el eventId ya atado.
async function marcarListo(eventId: string) {
  "use server";
  await setEventStatus(eventId, "ready");
}

async function marcarEnVivo(eventId: string) {
  "use server";
  await setEventStatus(eventId, "live");
}

async function volverABorrador(eventId: string) {
  "use server";
  await setEventStatus(eventId, "draft");
}
