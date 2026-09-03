import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEventAccess } from "@/features/events/lib/access";
import { getDivisions, getDocumentos } from "@/features/events/config/queries";
import { updateEvent } from "@/features/events/actions";
import { FichaDelEvento } from "@/features/events/components/FichaDelEvento";
import { PasosDelAsistente } from "@/features/events/components/PasosDelAsistente";
import { DocumentosDelEvento } from "@/features/events/components/DocumentosDelEvento";
import { PasoInscripcionAsistente } from "@/features/inscripciones/components/PasoInscripcionAsistente";
import { PASOS, indiceDelPaso, pasoAnterior, pasoSiguiente } from "@/features/events/lib/asistente";
import { fechaHoraEnEvento } from "@/shared/utils/fecha";
import { nombreDePais } from "@/shared/utils/paises";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AsistentePage({
  params,
}: {
  params: Promise<{ id: string; paso: string }>;
}) {
  const { id, paso } = await params;
  const acceso = await requireEventAccess(id);
  if (!acceso.canManage) notFound();

  const definicion = PASOS[indiceDelPaso(paso)];
  if (definicion.slug !== paso) notFound();

  const { event } = acceso;
  const siguiente = pasoSiguiente(paso);
  const anterior = pasoAnterior(paso);

  // `max-w-4xl`: con `2xl` el formulario ocupaba una franja angosta en el medio
  // y dejaba media pantalla vacia a cada lado en un escritorio, que es donde se
  // configura una competencia. Ancho suficiente para dos columnas de campos sin
  // que una linea de texto se vuelva ilegible de tan larga.
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 lg:p-10">
      <div>
        <Link href="/panel" className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Mis Competencias
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{event.name}</h1>
      </div>

      <PasosDelAsistente actual={paso} eventId={id} />

      {/* El titulo del paso va DEBAJO del indicador y no arriba: primero se ve
          donde se esta en el camino, y despues que hay que hacer aqui. */}
      <div className="border-b border-neutral-800 pb-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold tracking-tight">{definicion.titulo}</h2>
          {/* Marcar lo opcional evita que alguien se trabe buscando que le falta
              en un paso que puede saltear. */}
          {definicion.opcional && (
            <span className="rounded-full border border-neutral-800 px-2.5 py-0.5 text-xs text-neutral-500">
              Opcional
            </span>
          )}
        </div>
        <p className="mt-1.5 max-w-2xl text-sm text-neutral-400">{definicion.ayuda}</p>
      </div>

      {/*
        NI "general" NI "inscripcion" USAN EL <nav> DE ABAJO.
        Los dos guardan de verdad al avanzar —no hay ningun boton "Guardar"
        suelto en la pantalla— asi que "Continuar" ES el submit de su propio
        formulario, no un link aparte. `FichaDelEvento` ya renderiza su boton
        al final (aca dice "Continuar →" via `submitLabel`, y como "general"
        es siempre el primer paso tampoco hay "Anterior" que mostrar).
        `FormularioInscripcionAsistente` arma su propia fila de Anterior +
        Continuar porque el codigo de descuento se intercala entre el
        formulario grande y esos botones.
      */}
      {paso === "general" && (
        <FichaDelEvento
          action={updateEvent}
          hidden={{ eventId: id }}
          evento={event}
          submitLabel="Continuar →"
        />
      )}

      {paso === "documentos" && <PasoDocumentos eventId={id} />}

      {paso === "inscripcion" && <PasoInscripcionAsistente eventId={id} />}
      {paso === "resumen" && <PasoResumen eventId={id} />}

      {(paso === "documentos" || paso === "resumen") && (
        <nav className="flex items-center justify-between gap-3 border-t border-neutral-800 pt-6">
          {anterior ? (
            <Link
              href={`/panel/asistente/${id}/${anterior.slug}`}
              className="rounded-xl border border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-900"
            >
              ← {anterior.titulo}
            </Link>
          ) : (
            <span />
          )}

          {siguiente ? (
            <Link
              href={`/panel/asistente/${id}/${siguiente.slug}`}
              className="rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300"
            >
              {/* "Continuar" y no el nombre del siguiente: el indicador de arriba
                  ya dice cual viene, y repetirlo hace que el boton crezca y
                  encoja de paso en paso. */}
              Continuar →
            </Link>
          ) : (
            <Link
              href={`/panel/eventos/${id}`}
              className="rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300"
            >
              Finalizar
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}

/**
 * El resumen: que quedo cargado en cada paso del ASISTENTE, y que falta.
 *
 * Habla de los TRES pasos —ficha, documentos e inscripcion— y NO de categorias
 * ni pruebas: esas viven en "Configuracion competencia", que ya tiene su propio
 * indice con cuanto hay cargado. Repetirlas aca era la misma informacion en dos
 * pantallas, y las dos actualizandose por separado.
 *
 * NO MUESTRA ERRORES NI AVISOS DE `getConfigIssues`. Esos —"falta cargar
 * categorías", "un heat sin arena"— son sobre la competencia ENTERA, no sobre
 * lo que se llena en este asistente, y ya se muestran en el resumen de la
 * competencia (`/panel/eventos/[id]`, la pestaña "Resumen"). Tenerlos en los
 * dos lados era la misma advertencia en dos pantallas actualizandose por
 * separado; este resumen se queda solo con lo que el asistente sabe.
 */
async function PasoResumen({ eventId }: { eventId: string }) {
  const { event } = await requireEventAccess(eventId);
  const supabase = await createClient();

  const [divisiones, documentos, { data: precios }, { data: medios }] = await Promise.all([
    getDivisions(eventId),
    getDocumentos(eventId),
    supabase.from("division_registration").select("price_cents").eq("event_id", eventId),
    // Filtrado por la organizacion DUEÑA de este evento — sin el `eq("org_id",
    // ...)` esto contaba los medios activos de TODAS las organizaciones que
    // administra el usuario, sumados, y mostraba ese numero en cualquier
    // competencia sin importar a cual pertenecia cada medio.
    supabase
      .from("payment_providers")
      .select("provider")
      .eq("org_id", event.org_id)
      .eq("active", true),
  ]);

  const terminos = documentos.filter((d) => d.requiresAcceptance).length;
  const informativos = documentos.length - terminos;
  const conPrecio = (precios ?? []).filter((p) => (p.price_cents ?? 0) > 0).length;
  const mediosActivos = (medios ?? []).length;

  const bloques: Array<{
    titulo: string;
    href: string;
    accion: string;
    filas: Array<[string, string, boolean]>;
  }> = [
    {
      titulo: "Información general",
      href: `/panel/asistente/${eventId}/general`,
      accion: "Editar",
      filas: [
        ["Nombre", event.name, true],
        [
          "Cuándo",
          event.starts_at ? fechaHoraEnEvento(event.starts_at, event.timezone) : "Sin fecha",
          event.starts_at !== null,
        ],
        [
          "Dónde",
          [event.venue, event.city, nombreDePais(event.country)].filter(Boolean).join(", ") ||
            "Sin ubicación",
          Boolean(event.city || event.venue),
        ],
      ],
    },
    {
      titulo: "Documentos",
      href: `/panel/asistente/${eventId}/documentos`,
      accion: "Editar",
      filas: [
        ["Informativos", informativos === 0 ? "Ninguno" : `${informativos}`, informativos > 0],
        // Que no se pidan terminos NO es un faltante: una competencia puede no
        // pedir aceptar nada, y marcarlo mandaria a buscar un problema que no
        // existe.
        ["Términos por aceptar", terminos === 0 ? "No se piden" : `${terminos}`, true],
      ],
    },
    {
      titulo: "Inscripción",
      href: `/panel/asistente/${eventId}/inscripcion`,
      accion: "Editar",
      filas: [
        [
          "Cierran",
          event.registration_closes_at
            ? fechaHoraEnEvento(event.registration_closes_at, event.timezone)
            : "Sin ventana definida",
          event.registration_closes_at !== null,
        ],
        [
          "Medios de cobro",
          mediosActivos === 0 ? "Ninguno activo" : `${mediosActivos} activos`,
          // Sin medio de cobro no se puede cobrar, pero una competencia gratuita
          // es valida: solo falta si hay algo que cobrar.
          mediosActivos > 0 || conPrecio === 0,
        ],
        [
          "Categorías con precio",
          conPrecio === 0 ? "Ninguna (sin costo)" : `${conPrecio} de ${divisiones.length}`,
          true,
        ],
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {bloques.map((bloque) => (
        <section key={bloque.titulo}>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-neutral-400 uppercase">{bloque.titulo}</h3>
            <Link href={bloque.href} className="text-sm text-lime-400 hover:text-lime-300">
              {bloque.accion}
            </Link>
          </div>
          <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
            {bloque.filas.map(([etiqueta, valor, ok]) => (
              <li key={etiqueta} className="flex items-baseline justify-between gap-4 px-4 py-3">
                <span className="text-sm text-neutral-500">{etiqueta}</span>
                <span className={`text-right text-sm ${ok ? "" : "text-neutral-600"}`}>
                  {ok ? "" : "— "}
                  {valor}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="text-sm text-neutral-500">
        Esto es lo que se cargó en el asistente. Categorías, pruebas y si la competencia ya puede
        pasar a lista se revisan en el{" "}
        <Link href={`/panel/eventos/${eventId}`} className="text-lime-400 hover:text-lime-300">
          resumen de la competencia
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * Los documentos, en su propio paso.
 *
 * Estuvieron un rato al final del paso "general" y no se veian nunca: al crear
 * la competencia, `createEvent` redirige directo a categorias, asi que nadie
 * volvia a ese paso. Un paso propio los hace inevitables y ademas necesita que
 * el evento YA exista — sin id no hay carpeta donde subir.
 */
async function PasoDocumentos({ eventId }: { eventId: string }) {
  const documentos = await getDocumentos(eventId);
  return <DocumentosDelEvento eventId={eventId} documentos={documentos} />;
}
