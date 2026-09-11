import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEventAccess } from "@/features/events/lib/access";
import {
  getCategoriasConfiguradas,
  getDivisions,
} from "@/features/events/config/queries";
import {
  getCatalogoDeMovimientos,
  getPruebaCompleta,
  getPruebas,
  type ParteCompleta,
} from "@/features/workouts/queries";
import {
  agregarBloque,
  agregarParte,
  alternarCategoria,
  borrarBloque,
  borrarMovimiento,
  borrarParte,
  type FormState,
} from "@/features/workouts/actions";
import { describirParte } from "@/features/workouts/lib/describir";
import { SimpleForm, Field, Select, FieldRow } from "@/shared/components/SimpleForm";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { NuevoMovimiento } from "@/features/workouts/components/NuevoMovimiento";
import { EditarPrueba, EditarParte } from "@/features/workouts/components/EditarParte";
import {
  EditarBloque,
  EditarMovimiento,
} from "@/features/workouts/components/EditarMovimiento";
import { BotonesDeOrden } from "@/features/workouts/components/BotonesDeOrden";
import { PesosPorCategoria } from "@/features/workouts/components/PesosPorCategoria";
import { VistaPreviaDelWod } from "@/features/workouts/components/VistaPreviaDelWod";
import { SimuladorDeJuez } from "@/features/workouts/components/SimuladorDeJuez";
import { armarEstructuraDeWod } from "@/shared/timing/wodStructure";
import { desdeKilos } from "@/shared/unidades/carga";

/**
 * El constructor de una prueba, con TODAS sus partes.
 *
 * LA RUTA ES POR PRUEBA Y NO POR PARTE. Antes era `/pruebas/[partId]`, y ese
 * era el motivo por el que "agregar la parte B" no tenía dónde vivir: la
 * pantalla se llamaba "la prueba" pero era una parte suelta, y las dos palabras
 * se usaban como sinónimos siendo cosas distintas. Con una sola parte —el caso
 * de casi todos los WODs y de todo circuito— la palabra "parte" no aparece.
 */

const TIPO_DE_BLOQUE: Record<string, string> = {
  buy_in: "Buy-in",
  trabajo: "Trabajo",
  descanso: "Descanso",
  cash_out: "Cash-out",
};

export default async function PruebaPage({
  params,
}: {
  params: Promise<{ id: string; workoutId: string }>;
}) {
  const { id, workoutId } = await params;
  const { canManage } = await requireEventAccess(id);

  const [prueba, divisiones, catalogo, categorias, todasLasPruebas] = await Promise.all([
    getPruebaCompleta(workoutId),
    getDivisions(id),
    getCatalogoDeMovimientos(),
    getCategoriasConfiguradas(id),
    getPruebas(id),
  ]);

  if (!prueba) notFound();

  const nombrePorMovimiento = new Map(catalogo.map((m) => [m.id, m.name]));
  const admiteCarga = new Map(catalogo.map((m) => [m.id, m.allows_load]));
  const nombreDivision = new Map(divisiones.map((d) => [d.id, d.name]));

  // Todas las partes del EVENTO, con su nombre ya armado, para el selector de
  // "de que prueba sale el desempate" — el tiebreak_part_id puede apuntar a
  // cualquier parte del evento, no solo a las de esta prueba.
  const todasLasPartes = todasLasPruebas.flatMap(({ workout, parts }) =>
    parts.map((p) => ({
      id: p.id,
      nombre: `${workout.name}${p.label ? ` ${p.label}` : ""}`,
    })),
  );

  /**
   * El peso que la categoría ya declaró para ese movimiento, por nombre.
   *
   * Es lo que une `division_movements` —el estándar publicado— con la grilla de
   * la prueba: si Elite ya dice "Thruster 43 kg", ese es el placeholder de la
   * celda. Va como SUGERENCIA y no como valor, porque el estándar de la
   * categoría y lo que pide un WOD concreto pueden diferir legítimamente.
   *
   * Viaja en KILOS CRUDOS, no formateada: la grilla puede tener seleccionada
   * una unidad distinta de la que declaró la categoría (Elite declaró "95 lb",
   * la grilla está en kg), y convertir acá con la unidad de la categoría
   * mostraría "95" como si fueran 95 kg. El componente la convierte con la
   * unidad VIGENTE de la grilla, igual que ya hace con el valor base.
   */
  const sugerencias: Record<string, number> = {};
  for (const categoria of categorias) {
    for (const m of categoria.movimientos) {
      if (m.loadKg === null) continue;
      sugerencias[`${categoria.id}|${m.nombre}`] = m.loadKg;
    }
  }

  const unaSolaParte = prueba.partes.length === 1;

  async function quitarBloque(blockId: string, _p: FormState, _f: FormData) {
    "use server";
    return borrarBloque(id, blockId);
  }
  async function quitarMovimiento(movId: string, _p: FormState, _f: FormData) {
    "use server";
    return borrarMovimiento(id, movId);
  }
  async function sumarParte(_p: FormState, _f: FormData) {
    "use server";
    return agregarParte(id, workoutId);
  }
  async function quitarParte(partId: string, _p: FormState, _f: FormData) {
    "use server";
    return borrarParte(id, workoutId, partId);
  }
  async function alternar(
    partId: string,
    divisionId: string,
    activar: boolean,
    _p: FormState,
    _f: FormData,
  ) {
    "use server";
    return alternarCategoria(id, partId, divisionId, activar);
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      <div>
        <Link
          href={`/panel/eventos/${id}/pruebas`}
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          ← Pruebas
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{prueba.workout.name}</h2>
          {canManage && <EditarPrueba eventId={id} workout={prueba.workout} />}
        </div>
        {prueba.workout.description && (
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">
            {prueba.workout.description}
          </p>
        )}
      </div>

      {prueba.partes.map((parte) => (
        <SeccionDeParte
          key={parte.part.id}
          eventId={id}
          parte={parte}
          unaSolaParte={unaSolaParte}
          canManage={canManage}
          divisiones={divisiones}
          nombreDivision={nombreDivision}
          nombrePorMovimiento={nombrePorMovimiento}
          admiteCarga={admiteCarga}
          catalogo={catalogo}
          sugerencias={sugerencias}
          otrasPartes={todasLasPartes.filter((p) => p.id !== parte.part.id)}
          quitarBloque={quitarBloque}
          quitarMovimiento={quitarMovimiento}
          quitarParte={quitarParte}
          alternar={alternar}
        />
      ))}

      {/* Solo con UNA parte. Es lo raro —la mayoría de los WODs tienen una— y
          ofrecerlo cuando ya hay dos invita a una tercera que casi nadie
          necesita. Borrar la B devuelve a la A su etiqueta vacía. */}
      {canManage && unaSolaParte && prueba.partes[0]?.part.time_scheme !== "circuito" && (
        <section className="rounded-2xl border border-dashed border-neutral-800 p-5">
          <h3 className="font-semibold">¿Tiene una segunda parte?</h3>
          <p className="mt-1 mb-4 max-w-xl text-sm text-neutral-500">
            Un AMRAP y después una carga máxima, por ejemplo. Se agendan juntas y
            las juzga la misma persona, pero cada una da su propio resultado y sus
            propios puntos.
          </p>
          <FormularioDeEstado
            accion={sumarParte}
            estadoInicial={{ error: null }}
            etiqueta="Agregar parte B"
            pendienteTexto="Agregando…"
            mensajeDeCarga="Agregando la parte…"
            className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-900"
          />
        </section>
      )}
    </div>
  );
}

function SeccionDeParte({
  eventId,
  parte,
  unaSolaParte,
  canManage,
  divisiones,
  nombreDivision,
  nombrePorMovimiento,
  admiteCarga,
  catalogo,
  sugerencias,
  otrasPartes,
  quitarBloque,
  quitarMovimiento,
  quitarParte,
  alternar,
}: {
  eventId: string;
  parte: ParteCompleta;
  unaSolaParte: boolean;
  canManage: boolean;
  divisiones: Array<{ id: string; name: string }>;
  nombreDivision: Map<string, string>;
  nombrePorMovimiento: Map<string, string>;
  admiteCarga: Map<string, boolean>;
  catalogo: Array<{ id: string; name: string; category: string; default_unit: string; allows_load: boolean }>;
  /** Kilos crudos por `${divisionId}|${nombreDelMovimiento}`; ver mas arriba. */
  sugerencias: Record<string, number>;
  otrasPartes: Array<{ id: string; nombre: string }>;
  quitarBloque: (blockId: string, p: FormState, f: FormData) => Promise<FormState>;
  quitarMovimiento: (movId: string, p: FormState, f: FormData) => Promise<FormState>;
  quitarParte: (partId: string, p: FormState, f: FormData) => Promise<FormState>;
  alternar: (
    partId: string,
    divisionId: string,
    activar: boolean,
    p: FormState,
    f: FormData,
  ) => Promise<FormState>;
}) {
  const { part, blocks, movements } = parte;
  const esCircuito = part.time_scheme === "circuito";
  const corren = new Set(parte.divisiones.map((d) => d.divisionId));
  const titulo = unaSolaParte ? "Cómo se puntúa" : `Parte ${part.label || "?"}`;

  const nombreDe = (m: (typeof movements)[number]) =>
    m.custom_name ?? nombrePorMovimiento.get(m.movement_id ?? "") ?? "movimiento";

  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-neutral-800 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{titulo}</h3>
          <p className="mt-0.5 text-sm text-neutral-400">{describirParte(part)}</p>
        </div>

        {canManage && !esCircuito && (
          <div className="flex items-center gap-1">
            <EditarParte eventId={eventId} part={part} titulo={titulo} otrasPartes={otrasPartes} />
            {!unaSolaParte && (
              <FormularioDeEstado
                accion={quitarParte.bind(null, part.id)}
                estadoInicial={{ error: null }}
                etiqueta="✕"
                pendienteTexto="…"
                mensajeDeCarga="Quitando la parte…"
                title="Quitar parte"
                className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
              />
            )}
          </div>
        )}
      </div>

      {esCircuito ? (
        <p className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3 text-sm text-neutral-400">
          Esta prueba es un circuito: su estructura son los segmentos que se
          editan en <span className="text-neutral-200">Circuito</span>, no bloques
          y movimientos.
        </p>
      ) : (
        <>
          <div>
            <h4 className="text-sm font-semibold text-neutral-400 uppercase">
              Categorías
            </h4>
            <ul className="mt-3 flex flex-wrap gap-2">
              {divisiones.map((d) => {
                const activa = corren.has(d.id);
                return (
                  <li key={d.id}>
                    <FormularioDeEstado
                      accion={alternar.bind(null, part.id, d.id, !activa)}
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
          </div>

          {blocks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
              Sin bloques todavía. Un bloque es una tanda de trabajo que se
              repite: un chipper es un bloque que se hace una vez, Fran es uno
              que se repite tres.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {blocks.map((bloque, indice) => {
                const suyos = movements.filter((m) => m.block_id === bloque.id);
                const esDescanso = bloque.kind === "descanso";
                return (
                  <li
                    key={bloque.id}
                    className={`rounded-xl p-4 ${
                      esDescanso
                        ? "border border-neutral-800 bg-neutral-950/60"
                        : "border border-neutral-700 bg-neutral-900/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 pb-3">
                      <div>
                        <p className="flex items-baseline gap-2 font-semibold">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-400">
                            {indice + 1}
                          </span>
                          <span>
                            {bloque.label ?? TIPO_DE_BLOQUE[bloque.kind] ?? bloque.kind}
                            {bloque.repeticiones > 1 && (
                              <span className="ml-2 text-sm font-normal text-neutral-400">
                                × {bloque.repeticiones} rondas
                              </span>
                            )}
                          </span>
                        </p>
                        {(bloque.duracion_ms || bloque.descanso_ms) && (
                          <p className="mt-0.5 ml-7 text-sm text-neutral-500">
                            {bloque.duracion_ms && `${bloque.duracion_ms / 1000}s de trabajo`}
                            {bloque.duracion_ms && bloque.descanso_ms && " · "}
                            {bloque.descanso_ms && `${bloque.descanso_ms / 1000}s de descanso`}
                          </p>
                        )}
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-1">
                          <BotonesDeOrden
                            eventId={eventId}
                            contenedorId={part.id}
                            ids={blocks.map((b) => b.id)}
                            actual={bloque.id}
                            tipo="bloque"
                          />
                          <EditarBloque eventId={eventId} bloque={bloque} />
                          <FormularioDeEstado
                            accion={quitarBloque.bind(null, bloque.id)}
                            estadoInicial={{ error: null }}
                            etiqueta="✕"
                            pendienteTexto="…"
                            mensajeDeCarga="Quitando el bloque…"
                            title="Quitar bloque"
                            className="px-2 py-1 text-sm text-neutral-600 hover:text-red-400"
                          />
                        </div>
                      )}
                    </div>

                    {suyos.length > 0 && (
                      <ul className="mt-3 flex flex-col gap-1.5 rounded-lg bg-black/25 p-2">
                        {suyos.map((m) => (
                          <li
                            key={m.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-neutral-900/60 px-3 py-2 text-sm"
                          >
                            <span className="flex items-center gap-2">
                              <span className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-xs text-lime-300">
                                {m.max_reps ? "máx" : m.target_per_round.join("-")}
                              </span>
                              <span>{nombreDe(m)}</span>
                              {m.load_kg !== null && (
                                <span className="text-neutral-400">
                                  {desdeKilos(m.load_kg, m.load_unit)} {m.load_unit}
                                </span>
                              )}
                              {m.unit !== "reps" && (
                                <span className="text-neutral-500">{m.unit}</span>
                              )}
                              {m.es_tiebreak && (
                                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300">
                                  desempate
                                </span>
                              )}
                            </span>

                            {canManage && (
                              <span className="flex items-center gap-1">
                                <BotonesDeOrden
                                  eventId={eventId}
                                  contenedorId={bloque.id}
                                  ids={suyos.map((x) => x.id)}
                                  actual={m.id}
                                  tipo="movimiento"
                                />
                                <EditarMovimiento
                                  eventId={eventId}
                                  movimiento={m}
                                  nombre={nombreDe(m)}
                                  esCargaMaxima={part.time_scheme === "sin_reloj"}
                                />
                                <FormularioDeEstado
                                  accion={quitarMovimiento.bind(null, m.id)}
                                  estadoInicial={{ error: null }}
                                  etiqueta="✕"
                                  pendienteTexto="…"
                                  mensajeDeCarga="Quitando el movimiento…"
                                  title="Quitar movimiento"
                                  className="px-2 text-neutral-600 hover:text-red-400"
                                />
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {canManage && !esDescanso && (
                      <details
                        className="mt-4 border-t border-neutral-800 pt-3"
                        open={suyos.length === 0}
                      >
                        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-lime-400 select-none hover:text-lime-300">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lime-400/10 text-xs">
                            +
                          </span>
                          Agregar movimiento
                        </summary>
                        <div className="mt-4">
                          <NuevoMovimiento
                            eventId={eventId}
                            partId={part.id}
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
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canManage && (
            <details className="rounded-xl border border-neutral-800 p-4">
              <summary className="cursor-pointer text-sm font-medium text-neutral-300">
                Agregar bloque
              </summary>
              <div className="mt-4">
                <SimpleForm
                  action={agregarBloque}
                  submitLabel="Agregar bloque"
                  hidden={{ eventId, partId: part.id }}
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
                      placeholder="1 (vacío = sin límite, si la prueba es AMRAP)"
                    />
                  </FieldRow>
                  <FieldRow>
                    <Field
                      label="Duración (seg)"
                      name="duracionSegundos"
                      type="number"
                      placeholder="intervalos, o cuánto dura el descanso"
                    />
                    <Field
                      label="Descanso (seg)"
                      name="descansoSegundos"
                      type="number"
                      placeholder="solo intervalos"
                    />
                  </FieldRow>
                  <Field
                    label="Cap de este bloque (min)"
                    name="capMinutos"
                    type="number"
                    placeholder="Vacío = sin tope propio. No aplica a Descanso."
                    ayuda="Se mide desde que ARRANCA este bloque, no desde la largada del heat. Solo tiene efecto si la prueba tiene algún bloque de Descanso."
                  />
                </SimpleForm>
              </div>
            </details>
          )}

          {canManage && movements.length > 0 && (
            <PesosPorCategoria
              eventId={eventId}
              partId={part.id}
              movimientos={movements.map((m) => ({
                id: m.id,
                nombre: nombreDe(m),
                objetivoBase: m.target_per_round,
                cargaBaseKg: m.load_kg,
                cargaBaseUnidad: m.load_unit,
                admiteCarga: m.movement_id
                  ? (admiteCarga.get(m.movement_id) ?? true)
                  : true,
              }))}
              categorias={parte.divisiones.map((d) => ({
                id: d.divisionId,
                nombre: nombreDivision.get(d.divisionId) ?? "Categoría",
              }))}
              iniciales={Object.fromEntries(
                [...parte.specs.entries()].map(([clave, spec]) => [
                  clave,
                  {
                    objetivo: spec.targetPerRound?.join("-") ?? "",
                    carga:
                      spec.loadKg === null
                        ? ""
                        : String(desdeKilos(spec.loadKg, spec.loadUnit)),
                  },
                ]),
              )}
              unidadInicial={
                [...parte.specs.values()][0]?.loadUnit ??
                movements[0]?.load_unit ??
                "kg"
              }
              sugerencias={sugerencias}
            />
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-neutral-400 uppercase">
                Como lo ve el juez
              </h4>
              <SimuladorDeJuez
                estructura={armarEstructuraDeWod({
                  parte: part,
                  bloques: blocks,
                  movimientos: movements,
                  nombres: nombrePorMovimiento,
                  specs: new Map(),
                })}
              />
            </div>
            <div className="mt-3">
              <VistaPreviaDelWod
                part={part}
                blocks={blocks}
                movements={movements}
                nombres={nombrePorMovimiento}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
