import { requireEventAccess } from "@/features/events/lib/access";
import { getInscripcionesDelEvento } from "@/features/inscripciones/queries";
import { textoDeEstado, claseDeTexto } from "@/features/inscripciones/lib/estados";
import type { Readiness } from "@/features/inscripciones/lib/estados";
import { ConfiguracionDeInscripciones } from "@/features/inscripciones/components/ConfiguracionDeInscripciones";
import { ConfirmarPago } from "@/features/pagos/components/ConfirmarPago";
import { getIntentosPendientesDelEvento, getOrdenesDelEvento } from "@/features/pagos/queries";

export const dynamic = "force-dynamic";

function precio(cents: number | null, moneda: string | null): string {
  if (!cents) return "Sin costo";
  return new Intl.NumberFormat("es", {
    style: "currency",
    currency: moneda ?? "COP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * "Atleta | Categoría | Pago | Datos | Waiver | Estado" del rediseño, en la
 * forma de una sola pastilla: la grilla completa es una version mas grande
 * de esto mismo, y una fila con diez columnas repetidas para cada
 * inscripcion hubiera sido mas ruido que señal en una lista que ya muestra
 * el estado de pago (`ConfirmarPago`) y de integrantes aparte.
 */
const READINESS: Record<Readiness, { texto: string; clase: string }> = {
  incompleto: { texto: "Incompleto", clase: "bg-neutral-800 text-neutral-400" },
  accion_requerida: { texto: "Acción requerida", clase: "bg-amber-400/15 text-amber-300" },
  listo: { texto: "Listo para competir", clase: "bg-lime-400/15 text-lime-300" },
};

export default async function InscripcionesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);

  if (!canManage) {
    return (
      <p className="mt-6 rounded-2xl border border-neutral-800 p-6 text-sm text-neutral-400">
        Solo la organización ve las inscripciones.
      </p>
    );
  }

  const [inscripciones, ordenes, intentosPorOrden] = await Promise.all([
    getInscripcionesDelEvento(id),
    getOrdenesDelEvento(id),
    getIntentosPendientesDelEvento(id),
  ]);

  const confirmadas = inscripciones.filter((i) => i.status === "confirmada").length;
  const pendientes = inscripciones.filter(
    (i) => i.status === "esperando_pago" || i.status === "esperando_integrantes",
  ).length;
  const listas = inscripciones.filter((i) => i.readiness === "listo").length;

  return (
    <div className="mt-6 flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Inscripciones</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {inscripciones.length === 0
            ? "Todavía no se anotó nadie."
            : `${confirmadas} confirmadas (${listas} listas para competir) · ${pendientes} pendientes · ${inscripciones.length} en total`}
        </p>
      </div>

      {/* La misma configuración que el paso del asistente: una segunda copia
          garantizaría que un día ofrezcan cosas distintas. */}
      <ConfiguracionDeInscripciones eventId={id} />

      {inscripciones.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-neutral-800 pt-8">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase">Anotados</h3>
          <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
            {inscripciones.map((i) => {
              return (
                <li key={i.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {i.bib !== null && (
                      <span className="font-mono tabular-nums text-neutral-400">#{i.bib}</span>
                    )}
                    <span className="font-medium">
                      {i.teamName ?? i.integrantes[0]?.nombre ?? "Sin nombre"}
                    </span>
                    <span className="text-sm text-neutral-500">{i.divisionName}</span>
                    <span className="ml-auto flex items-center gap-2">
                      {i.status === "confirmada" && (
                        <span
                          className={`rounded-lg px-2 py-0.5 text-xs font-medium ${READINESS[i.readiness].clase}`}
                        >
                          {READINESS[i.readiness].texto}
                        </span>
                      )}
                      <span className={`text-sm ${claseDeTexto(i.status)}`}>
                        {textoDeEstado(i.status)}
                      </span>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
                    {i.integrantes.map((m) => (
                      <span key={m.email} className={m.completo ? "" : "text-amber-400/80"}>
                        {m.nombre || m.email}
                        {!m.completo && " (falta)"}
                        {m.completo && !m.aceptoTerminos && (
                          <span className="text-red-400/80"> · waiver pendiente</span>
                        )}
                      </span>
                    ))}
                    <span className="ml-auto">{precio(i.priceCents, i.currency)}</span>
                  </div>

                  {i.status === "esperando_pago" && (
                    <ConfirmarPago
                      orderId={ordenes.get(i.id)?.id ?? null}
                      registrationId={i.id}
                      eventId={id}
                      intentos={
                        ordenes.get(i.id)
                          ? intentosPorOrden.get(ordenes.get(i.id)!.id)
                          : undefined
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
