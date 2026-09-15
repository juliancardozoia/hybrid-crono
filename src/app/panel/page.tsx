import Link from "next/link";
import { listEventosQueOrganizo } from "@/features/events/queries";
import { getMisInscripciones } from "@/features/inscripciones/queries";
import { getPerfil } from "@/features/cuenta/queries";
import { puedeJuzgar, getJudgeLanes } from "@/features/judge/queries";
import { rangoDeFechas } from "@/features/catalogo/lib/formato";
import { traduccion } from "@/shared/i18n/servidor";
import { Icono } from "@/shared/components/Icono";
import type { EventStatus } from "@/lib/supabase/types";

export const metadata = { title: "Panel — Scora" };

/**
 * Un solo punto de entrada, adaptable por rol.
 *
 * Antes esta pantalla era EXCLUSIVA del organizador ("Mis Competencias"), y
 * `/cuenta` era la del atleta -- dos espacios separados a proposito (ver el
 * comentario viejo de `layout.tsx`). Se unifican aca: la misma cuenta compite,
 * organiza y juzga, y las tres cosas conviven en la MISMA pantalla, cada una
 * en su propia seccion que aparece solo si aplica. Un atleta puro ve
 * "Compito" y la invitacion a crear una competencia si quiere; un organizador
 * ve sus eventos; alguien con las tres facetas las ve las tres.
 *
 * Confirmar una inscripcion (`confirmarInscripcionIndividual`) redirige
 * DERECHO ACA: es el destino natural despues de inscribirse, no una pantalla
 * de "tramite completo" separada.
 */

const ESTADO_INSCRIPCION: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Sin enviar", clase: "bg-neutral-800 text-neutral-300" },
  esperando_integrantes: { texto: "Faltan integrantes", clase: "bg-amber-400/15 text-amber-300" },
  esperando_pago: { texto: "Falta pagar", clase: "bg-amber-400/15 text-amber-300" },
  confirmada: { texto: "Confirmada", clase: "bg-lime-400/15 text-lime-300" },
  cancelada: { texto: "Cancelada", clase: "bg-red-500/15 text-red-300" },
  lista_espera: { texto: "En lista de espera", clase: "bg-neutral-800 text-neutral-300" },
};

const ESTADO_EVENTO: Record<EventStatus, { texto: string; clase: string }> = {
  draft: { texto: "Borrador", clase: "bg-neutral-800 text-neutral-400" },
  ready: { texto: "Lista", clase: "bg-sky-500/15 text-sky-300" },
  live: { texto: "En vivo", clase: "bg-lime-500/15 text-lime-300" },
  verifying: { texto: "Verificando", clase: "bg-amber-500/15 text-amber-300" },
  published: { texto: "Publicada", clase: "bg-emerald-500/15 text-emerald-300" },
};

export default async function PanelPage() {
  const [perfil, { idioma }, inscripciones, eventosQueOrganizo, mostrarJuzgar] = await Promise.all([
    getPerfil(),
    traduccion(),
    getMisInscripciones(),
    listEventosQueOrganizo(),
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
          {perfil?.fullName ? `Hola, ${perfil.fullName.split(" ")[0]}` : "Tu panel"}
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
              const estado = ESTADO_INSCRIPCION[i.status] ?? {
                texto: i.status,
                clase: "bg-neutral-800 text-neutral-300",
              };
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
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${estado.clase}`}>
                      {estado.texto}
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

      {/* ORGANIZO. Con eventos, la lista; sin ninguno, la invitacion a crear
          la primera -- el mismo camino que ya existia, ahora una seccion mas
          en vez de ser lo unico que esta pantalla mostraba. */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Organizo</h2>
          {eventosQueOrganizo.length > 0 && (
            <Link
              href="/panel/eventos/nuevo"
              className="rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300"
            >
              Nueva competencia
            </Link>
          )}
        </div>

        {eventosQueOrganizo.length === 0 ? (
          <PrimeraVez />
        ) : (
          <ul className="flex flex-col gap-2">
            {eventosQueOrganizo.map((e) => {
              const estado = ESTADO_EVENTO[e.status];
              return (
                <li key={e.id}>
                  <Link
                    href={`/panel/eventos/${e.id}`}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-800 p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{e.name}</p>
                      <p className="truncate text-sm text-neutral-500">
                        {[e.venue, e.event_date].filter(Boolean).join(" · ") || "Sin fecha ni sede"}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${estado.clase}`}>
                      {estado.texto}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * Lo que ve alguien que nunca organizo nada.
 *
 * Un solo camino y bien grande. No crea ninguna organizacion por mostrarse
 * -- eso lo hace recien `panel/eventos/nuevo/page.tsx` cuando de verdad se
 * aprieta el boton.
 */
function PrimeraVez() {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-10 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-lime-400/10 text-lime-400">
        <Icono nombre="trofeo" className="h-7 w-7" />
      </span>

      <h2 className="mt-5 text-xl font-bold">Crea tu primera competencia</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
        Te vamos a ir pidiendo los datos por pasos: nombre y fecha, categorías, pruebas y
        precios. Se guarda como borrador desde el primer paso, así que puedes cerrar y seguir
        después.
      </p>

      <Link
        href="/panel/eventos/nuevo"
        className="mt-6 inline-block rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300"
      >
        Crear competencia
      </Link>
    </div>
  );
}
