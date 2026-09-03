import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEventAccess } from "@/features/events/lib/access";
import { getDivisions } from "@/features/events/config/queries";
import {
  getCatalogoDeMovimientos,
  getEstructura,
} from "@/features/workouts/queries";
import {
  agregarBloque,
  alternarCategoria,
  borrarBloque,
  borrarMovimiento,
  type FormState,
} from "@/features/workouts/actions";
import { describirParte } from "@/features/workouts/lib/describir";
import {
  SimpleForm,
  Field,
  Select,
  FieldRow,
} from "@/shared/components/SimpleForm";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { NuevoMovimiento } from "@/features/workouts/components/NuevoMovimiento";
import { ModoDeCaptura } from "@/features/workouts/components/ModoDeCaptura";
import { getEstadoDelPlan } from "@/features/planes/queries";

const TIPO_DE_BLOQUE: Record<string, string> = {
  buy_in: "Buy-in",
  trabajo: "Trabajo",
  descanso: "Descanso",
  cash_out: "Cash-out",
};

export default async function PartePage({
  params,
}: {
  params: Promise<{ id: string; partId: string }>;
}) {
  const { id, partId } = await params;
  const { canManage } = await requireEventAccess(id);

  const [estructura, divisiones, catalogo, plan] = await Promise.all([
    getEstructura(partId),
    getDivisions(id),
    getCatalogoDeMovimientos(),
    getEstadoDelPlan(id),
  ]);

  if (!estructura) notFound();

  const { part, blocks, movements, divisionIds } = estructura;
  const nombrePorMovimiento = new Map(catalogo.map((m) => [m.id, m.name]));
  const corren = new Set(divisionIds);

  async function alternar(
    divisionId: string,
    activar: boolean,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return alternarCategoria(id, partId, divisionId, activar);
  }
  async function quitarBloque(
    blockId: string,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return borrarBloque(id, blockId);
  }
  async function quitarMovimiento(
    movimientoId: string,
    _prev: FormState,
    _formData: FormData,
  ) {
    "use server";
    return borrarMovimiento(id, movimientoId);
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div>
        <Link
          href={`/panel/eventos/${id}/pruebas`}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          ← Pruebas
        </Link>
        <h2 className="mt-2 text-lg font-semibold">{describirParte(part)}</h2>
        {part.time_scheme === "circuito" && (
          <p className="mt-2 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 text-sm text-neutral-400">
            Esta prueba es un circuito: su estructura son los segmentos que se
            editan en la pestaña{" "}
            <span className="text-neutral-200">Circuito</span>, no bloques y
            movimientos.
          </p>
        )}
      </div>

      {/* Un circuito se juzga en vivo siempre: es la app que ya existía, y su
          modo de captura no es una decisión del organizador. */}
      {canManage && part.time_scheme !== "circuito" && (
        <section className="rounded-2xl border border-neutral-800 p-5">
          <h3 className="font-semibold">Cómo se puntúa</h3>
          <p className="mt-1 mb-4 text-sm text-neutral-500">
            Decide quién produce el resultado de esta prueba.
          </p>
          <ModoDeCaptura
            eventId={id}
            partId={partId}
            actual={part.capture_mode}
            bloqueado={plan ? !plan.puedeJuzgarEnVivo : false}
          />
        </section>
      )}

      <section className="rounded-2xl border border-neutral-800 p-5">
        <h3 className="font-semibold">Categorías que la corren</h3>
        <p className="mt-1 text-sm text-neutral-500">
          Solo a estas se les pide resultado. Una categoría fuera de la lista no
          aparece en la carga.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {divisiones.map((d) => {
            const activa = corren.has(d.id);
            return (
              <li key={d.id}>
                <FormularioDeEstado
                  accion={alternar.bind(null, d.id, !activa)}
                  estadoInicial={{ error: null }}
                  etiqueta={`${activa ? "✓ " : ""}${d.name}`}
                  pendienteTexto="…"
                  mensajeDeCarga="Actualizando la categoría…"
                  disabled={!canManage}
                  className={`rounded-xl border px-3 py-2 text-sm transition-colors disabled:opacity-60 ${
                    activa
                      ? "border-lime-400 text-lime-300"
                      : "border-neutral-700 text-neutral-500 hover:border-neutral-600"
                  }`}
                />
              </li>
            );
          })}
        </ul>
      </section>

      {part.time_scheme !== "circuito" && (
        <>
          {blocks.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
              Sin bloques todavía. Un bloque es una tanda de trabajo que se
              repite: un chipper es un bloque que se hace una vez, Fran es uno
              que se repite tres.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {blocks.map((bloque) => {
                const suyos = movements.filter((m) => m.block_id === bloque.id);
                return (
                  <li
                    key={bloque.id}
                    className="rounded-2xl border border-neutral-800 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          {TIPO_DE_BLOQUE[bloque.kind] ?? bloque.kind}
                          {bloque.repeticiones > 1 && (
                            <span className="ml-2 text-sm text-neutral-400">
                              × {bloque.repeticiones} rondas
                            </span>
                          )}
                        </p>
                        {(bloque.duracion_ms || bloque.descanso_ms) && (
                          <p className="mt-0.5 text-sm text-neutral-500">
                            {bloque.duracion_ms &&
                              `${bloque.duracion_ms / 1000}s de trabajo`}
                            {bloque.duracion_ms && bloque.descanso_ms && " · "}
                            {bloque.descanso_ms &&
                              `${bloque.descanso_ms / 1000}s de descanso`}
                          </p>
                        )}
                      </div>
                      {canManage && (
                        <FormularioDeEstado
                          accion={quitarBloque.bind(null, bloque.id)}
                          estadoInicial={{ error: null }}
                          etiqueta="✕"
                          pendienteTexto="…"
                          mensajeDeCarga="Quitando el bloque…"
                          title="Quitar bloque"
                          className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
                        />
                      )}
                    </div>

                    {suyos.length > 0 && (
                      <ul className="mt-3 divide-y divide-neutral-800 border-t border-neutral-800">
                        {suyos.map((m) => (
                          <li
                            key={m.id}
                            className="flex items-center justify-between gap-3 py-2 text-sm"
                          >
                            <span>
                              <span className="font-mono text-neutral-400">
                                {m.max_reps
                                  ? "máx"
                                  : m.target_per_round.join("-")}
                              </span>{" "}
                              {m.custom_name ??
                                nombrePorMovimiento.get(m.movement_id ?? "") ??
                                "movimiento"}
                              {m.load_kg !== null && (
                                <span className="ml-2 text-neutral-400">
                                  {m.load_kg} kg
                                </span>
                              )}
                              {m.unit !== "reps" && (
                                <span className="ml-2 text-neutral-500">
                                  {m.unit}
                                </span>
                              )}
                              {m.es_tiebreak && (
                                <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300">
                                  desempate
                                </span>
                              )}
                            </span>
                            {canManage && (
                              <FormularioDeEstado
                                accion={quitarMovimiento.bind(null, m.id)}
                                estadoInicial={{ error: null }}
                                etiqueta="✕"
                                pendienteTexto="…"
                                mensajeDeCarga="Quitando el movimiento…"
                                title="Quitar movimiento"
                                className="px-2 text-neutral-600 hover:text-red-400"
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canManage && (
                      <div className="mt-4 border-t border-neutral-800 pt-4">
                        <NuevoMovimiento
                          eventId={id}
                          partId={partId}
                          blockId={bloque.id}
                          catalogo={catalogo.map((m) => ({
                            id: m.id,
                            name: m.name,
                            category: m.category,
                            defaultUnit: m.default_unit,
                            allowsLoad: m.allows_load,
                          }))}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canManage && (
            <section className="rounded-2xl border border-neutral-800 p-5">
              <h3 className="font-semibold">Agregar bloque</h3>
              <div className="mt-4">
                <SimpleForm
                  action={agregarBloque}
                  submitLabel="Agregar bloque"
                  hidden={{ eventId: id, partId }}
                >
                  <FieldRow>
                    <Select
                      label="Tipo"
                      name="kind"
                      defaultValue="trabajo"
                      options={[
                        { value: "trabajo", label: "Trabajo" },
                        { value: "buy_in", label: "Buy-in" },
                        { value: "cash_out", label: "Cash-out" },
                        { value: "descanso", label: "Descanso" },
                      ]}
                    />
                    <Field
                      label="Rondas"
                      name="repeticiones"
                      type="number"
                      placeholder="1"
                    />
                  </FieldRow>
                  <FieldRow>
                    <Field
                      label="Duración por ronda (seg)"
                      name="duracionSegundos"
                      type="number"
                      placeholder="solo intervalos"
                    />
                    <Field
                      label="Descanso (seg)"
                      name="descansoSegundos"
                      type="number"
                      placeholder="solo intervalos"
                    />
                  </FieldRow>
                </SimpleForm>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
