import Link from "next/link";
import { requireEventAccess } from "@/features/events/lib/access";
import { getPruebas } from "@/features/workouts/queries";
import { getDivisions } from "@/features/events/config/queries";
import {
  borrarPrueba,
  liberarPrueba,
  type FormState,
} from "@/features/workouts/actions";
import { NuevaPrueba } from "@/features/workouts/components/NuevaPrueba";
import { describirParte } from "@/features/workouts/lib/describir";
import { getEstadoDelPlan } from "@/features/planes/queries";
import { AvisoDePlan } from "@/features/planes/components/AvisoDePlan";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";

/**
 * Si el contenido de la prueba ya se ve en la ficha pública.
 *
 * Mismo criterio que `public_event_detail`: no alcanza con que la columna esté
 * cargada, la fecha tiene que haber pasado. Con una fecha futura la prueba
 * queda programada y acá se muestra como "Sin publicar", que es lo que un
 * atleta ve hoy.
 */
function estaLiberada(releasedAt: string | null): boolean {
  return releasedAt !== null && new Date(releasedAt) <= new Date();
}

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

  async function alternarPublicacion(
    workoutId: string,
    liberar: boolean,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return liberarPrueba(id, workoutId, liberar);
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Workouts</h2>
      </div>

      {plan && plan.pruebasManualesForzadas > 0 && (
        <AvisoDePlan estado={plan} motivo="en_vivo" />
      )}

      {pruebas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Sin pruebas todavía.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pruebas.map(({ workout, parts }) => (
            <li
              key={workout.id}
              className="rounded-xl border border-lime-400/30 bg-neutral-900/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-400">
                      {workout.order_index + 1}
                    </span>
                    {workout.name}
                    {/* El estado va PEGADO al nombre y no en una columna aparte:
                        "¿los atletas ya pueden ver este WOD?" es una propiedad de
                        la prueba, no una acción más de la fila. */}
                    {estaLiberada(workout.released_at) ? (
                      <span className="rounded-full bg-lime-400/15 px-2 py-0.5 text-xs font-semibold text-lime-300">
                        Publicada
                      </span>
                    ) : (
                      <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-500">
                        Sin publicar
                      </span>
                    )}
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
                      </li>
                    ))}
                  </ul>

                  {/* UN solo "Configurar" por prueba, fuera del bucle de partes:
                      la pantalla es de la prueba entera y con dos partes el
                      enlace aparecía repetido apuntando al mismo lugar. */}
                  {canManage && (
                    <Link
                      href={`/panel/eventos/${id}/pruebas/${workout.id}`}
                      className="mt-1 inline-block text-sm text-lime-400 hover:text-lime-300"
                    >
                      Configurar
                    </Link>
                  )}
                </div>

                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <FormularioDeEstado
                      accion={alternarPublicacion.bind(
                        null,
                        workout.id,
                        !estaLiberada(workout.released_at),
                      )}
                      estadoInicial={{ error: null }}
                      etiqueta={
                        estaLiberada(workout.released_at) ? "Ocultar" : "Publicar"
                      }
                      pendienteTexto="…"
                      mensajeDeCarga={
                        estaLiberada(workout.released_at)
                          ? "Ocultando la prueba…"
                          : "Publicando la prueba…"
                      }
                      title={
                        estaLiberada(workout.released_at)
                          ? "Dejar de mostrar el contenido en la ficha pública"
                          : "Mostrar el contenido en la ficha pública"
                      }
                      className="rounded-xl border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-600 disabled:opacity-60"
                    />
                    <FormularioDeEstado
                      accion={quitar.bind(null, id, workout.id)}
                      estadoInicial={{ error: null }}
                      etiqueta="✕"
                      pendienteTexto="…"
                      mensajeDeCarga="Quitando la prueba…"
                      title="Quitar prueba"
                      className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
                    />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage &&
        (divisiones.length === 0 ? (
          <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Crea primero las categorías: una prueba se le asigna a las
            categorías que la corren.
          </p>
        ) : (
          <NuevaPrueba eventId={id} />
        ))}
    </div>
  );
}
