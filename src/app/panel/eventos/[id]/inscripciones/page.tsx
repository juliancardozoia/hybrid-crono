import { requireEventAccess } from "@/features/events/lib/access";
import { getInscripcionesDelEvento } from "@/features/inscripciones/queries";
import { ConfiguracionDeInscripciones } from "@/features/inscripciones/components/ConfiguracionDeInscripciones";
import { ConfirmarPago } from "@/features/pagos/components/ConfirmarPago";
import { getOrdenesDelEvento } from "@/features/pagos/queries";

export const dynamic = "force-dynamic";

const ESTADO: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Sin enviar", clase: "text-neutral-500" },
  esperando_integrantes: { texto: "Faltan integrantes", clase: "text-amber-400" },
  esperando_pago: { texto: "Falta pagar", clase: "text-amber-400" },
  confirmada: { texto: "Confirmada", clase: "text-lime-400" },
  cancelada: { texto: "Cancelada", clase: "text-red-400" },
  lista_espera: { texto: "Lista de espera", clase: "text-neutral-500" },
};

function precio(cents: number | null, moneda: string | null): string {
  if (!cents) return "Sin costo";
  return new Intl.NumberFormat("es", {
    style: "currency",
    currency: moneda ?? "COP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

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

  const [inscripciones, ordenes] = await Promise.all([
    getInscripcionesDelEvento(id),
    getOrdenesDelEvento(id),
  ]);

  const confirmadas = inscripciones.filter((i) => i.status === "confirmada").length;
  const pendientes = inscripciones.filter(
    (i) => i.status === "esperando_pago" || i.status === "esperando_integrantes",
  ).length;

  return (
    <div className="mt-6 flex flex-col gap-8">
      <div>
        <h2 className="text-lg font-semibold">Inscripciones</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {inscripciones.length === 0
            ? "Todavía no se anotó nadie."
            : `${confirmadas} confirmadas · ${pendientes} pendientes · ${inscripciones.length} en total`}
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
              const estado = ESTADO[i.status] ?? ESTADO.borrador;
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
                    <span className={`ml-auto text-sm ${estado.clase}`}>{estado.texto}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
                    {i.integrantes.map((m) => (
                      <span key={m.email} className={m.completo ? "" : "text-amber-400/80"}>
                        {m.nombre || m.email}
                        {!m.completo && " (falta)"}
                      </span>
                    ))}
                    <span className="ml-auto">{precio(i.priceCents, i.currency)}</span>
                  </div>

                  {i.status === "esperando_pago" && (
                    <ConfirmarPago
                      orderId={ordenes.get(i.id)?.id ?? null}
                      registrationId={i.id}
                      eventId={id}
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
