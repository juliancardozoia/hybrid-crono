import Link from "next/link";
import { requireEventAccess } from "@/features/events/lib/access";
import { getPruebas } from "@/features/workouts/queries";
import { getDivisions } from "@/features/events/config/queries";
import { borrarPrueba, type FormState } from "@/features/workouts/actions";
import { NuevaPrueba } from "@/features/workouts/components/NuevaPrueba";
import { describirParte } from "@/features/workouts/lib/describir";
import { getEstadoDelPlan } from "@/features/planes/queries";
import { AvisoDePlan } from "@/features/planes/components/AvisoDePlan";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";

export default async function PruebasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { canManage } = await requireEventAccess(id);
  const [pruebas, divisiones, plan] = await Promise.all([
    getPruebas(id),
    getDivisions(id),
    getEstadoDelPlan(id),
  ]);

  async function quitar(
    eventId: string,
    workoutId: string,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return borrarPrueba(eventId, workoutId);
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Pruebas</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Cada prueba se describe con lo que mide y hacia dónde gana. Con eso
          alcanza para un AMRAP, un For Time con cap, un EMOM, una carga máxima
          o el circuito de una carrera híbrida.
        </p>
      </div>

      {plan && plan.pruebasManualesForzadas > 0 && (
        <AvisoDePlan estado={plan} motivo="en_vivo" />
      )}

      {pruebas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Sin pruebas todavía.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {pruebas.map(({ workout, parts }) => (
            <li
              key={workout.id}
              className="flex items-start justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="mr-2 font-mono text-sm text-neutral-500">
                    {workout.order_index + 1}
                  </span>
                  {workout.name}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {parts.map((parte) => (
                    <li key={parte.id} className="text-sm text-neutral-400">
                      {parte.label && (
                        <span className="mr-1.5 font-mono text-neutral-500">
                          {parte.label}
                        </span>
                      )}
                      {describirParte(parte)}
                      {canManage && (
                        <Link
                          href={`/panel/eventos/${id}/pruebas/${parte.id}`}
                          className="ml-3 text-lime-400 hover:text-lime-300"
                        >
                          Configurar
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {canManage && (
                <FormularioDeEstado
                  accion={quitar.bind(null, id, workout.id)}
                  estadoInicial={{ error: null }}
                  etiqueta="✕"
                  pendienteTexto="…"
                  mensajeDeCarga="Quitando la prueba…"
                  title="Quitar prueba"
                  className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage &&
        (divisiones.length === 0 ? (
          <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Crea primero las divisiones: una prueba se le asigna a las
            categorías que la corren.
          </p>
        ) : (
          <NuevaPrueba eventId={id} />
        ))}
    </div>
  );
}
