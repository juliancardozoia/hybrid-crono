"use client";

import { useMemo, useState } from "react";
import { HeatCard, type TeamOption } from "./HeatCard";
import { NuevoHeat } from "./NuevoHeat";
import { DistribuirHeats } from "./DistribuirHeats";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { Boton, claseDeBoton } from "@/shared/components/Boton";
import { Modal } from "@/shared/components/Modal";
import { Selector } from "@/shared/components/Selector";
import type { HeatWithLanes, JudgeOption } from "@/features/events/config/queries";

interface FormState {
  error: string | null;
}

type AccionQuitar = (
  eventId: string,
  heatId: string,
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

/**
 * La pantalla de heats: filtro por categoría en una sola fila junto con las
 * dos acciones de alta, y la lista agrupada debajo.
 *
 * ES CLIENTE por el filtro. Con quince heats o más repartidos en varias
 * categorías, una lista plana obliga a leerla entera para encontrar la
 * propia — el mismo motivo que ya llevó a la torre de control a este mismo
 * patrón (filtro + reloj en vivo en un componente de cliente que recibe los
 * datos ya resueltos del servidor).
 */
export function PantallaDeHeats({
  eventId,
  timezone,
  divisiones,
  pruebas,
  heats,
  opciones,
  judges,
  canManage,
  canVerify,
  quitarHeat,
}: {
  eventId: string;
  timezone: string;
  divisiones: Array<{ id: string; name: string }>;
  /** En el orden en que corren. Con una sola, la pantalla no la menciona. */
  pruebas: Array<{ id: string; name: string }>;
  heats: HeatWithLanes[];
  opciones: TeamOption[];
  judges: JudgeOption[];
  canManage: boolean;
  canVerify: boolean;
  quitarHeat: AccionQuitar;
}) {
  const [divisionId, setDivisionId] = useState("");
  const [workoutId, setWorkoutId] = useState("");

  const nombreDivision = useMemo(
    () => new Map(divisiones.map((d) => [d.id, d.name])),
    [divisiones],
  );

  const nombrePrueba = useMemo(() => new Map(pruebas.map((p) => [p.id, p.name])), [pruebas]);

  // El orden de las pruebas es el que ya trae `getPruebas` (order_index), no
  // alfabético: "WOD 10" va después de "WOD 9", y un orden alfabético lo
  // pondría entre el 1 y el 2.
  const ordenPrueba = useMemo(
    () => new Map(pruebas.map((p, i) => [p.id, i])),
    [pruebas],
  );

  const variasPruebas = pruebas.length > 1;

  // Solo se ofrecen las categorías que ya tienen algún heat: elegir una
  // vacía en el filtro solo mostraría "sin heats todavía" sin decir por qué.
  const divisionesConHeat = useMemo(() => {
    const ids = new Set(heats.map((h) => h.division_id).filter((x): x is string => Boolean(x)));
    return divisiones.filter((d) => ids.has(d.id));
  }, [divisiones, heats]);

  // Memoizado, y no un `.filter` suelto: `grupos` cuelga de esta referencia, y
  // un arreglo nuevo en cada render dejaría su useMemo sin efecto.
  const visibles = useMemo(
    () =>
      heats.filter(
        (h) =>
          (!divisionId || h.division_id === divisionId) &&
          (!workoutId || h.workout_id === workoutId),
      ),
    [heats, divisionId, workoutId],
  );

  // La clave agrupa por PRUEBA y categoría. Antes era solo la categoría, y
  // alcanzaba porque todos los heats de un evento corrían la misma prueba; con
  // tres WODs, "Individual Masculino" aparecía una sola vez con los heats de
  // los tres mezclados y sin nada que dijera cuál era cuál.
  const grupos = useMemo(() => {
    const mapa = new Map<string, HeatWithLanes[]>();
    for (const heat of visibles) {
      const clave = `${heat.workout_id}|${heat.division_id ?? ""}`;
      mapa.set(clave, [...(mapa.get(clave) ?? []), heat]);
    }
    return mapa;
  }, [visibles]);

  // Prueba primero y categoría después: el día del evento se trabaja un WOD
  // entero de una vez, no una categoría a lo largo de todos los WODs.
  const clavesOrdenadas = useMemo(
    () =>
      [...grupos.keys()].sort((a, b) => {
        const [wa, da] = a.split("|");
        const [wb, db] = b.split("|");
        const porPrueba = (ordenPrueba.get(wa) ?? 0) - (ordenPrueba.get(wb) ?? 0);
        if (porPrueba !== 0) return porPrueba;
        if (da === "") return 1;
        if (db === "") return -1;
        return (nombreDivision.get(da) ?? "").localeCompare(nombreDivision.get(db) ?? "");
      }),
    [grupos, nombreDivision, ordenPrueba],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Una sola fila, a todo el ancho: el filtro a la izquierda, las dos
          acciones de alta a la derecha. En celular se apila. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {variasPruebas && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500">Prueba</span>
              <Selector
                value={workoutId}
                onChange={(e) => setWorkoutId(e.target.value)}
                className="py-2 text-sm"
              >
                <option value="">Todas</option>
                {pruebas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Selector>
            </label>
          )}

          {divisionesConHeat.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-neutral-500">Categoría</span>
              <Selector
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
                className="py-2 text-sm"
              >
                <option value="">Todas</option>
                {divisionesConHeat.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Selector>
            </label>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <DistribuirHeats eventId={eventId} pruebas={pruebas} />
            <NuevoHeat eventId={eventId} divisiones={divisiones} pruebas={pruebas} />
          </div>
        )}
      </div>

      {heats.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Sin heats todavía.
        </p>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Ningún heat coincide con el filtro.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {clavesOrdenadas.map((clave) => {
            const [claveWorkout, claveDivision] = clave.split("|");
            const categoria = claveDivision
              ? (nombreDivision.get(claveDivision) ?? "Categoría")
              : "Sin categoría";

            return (
            <section key={clave} className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold tracking-wide text-neutral-400 uppercase">
                {/* El nombre de la prueba solo aparece cuando hay más de una:
                    en una carrera híbrida repetir "Circuito" arriba de cada
                    grupo es ruido que no distingue nada. */}
                {variasPruebas && (
                  <span className="text-lime-400">
                    {nombrePrueba.get(claveWorkout) ?? "Prueba"}
                    <span className="mx-2 text-neutral-700">·</span>
                  </span>
                )}
                {categoria}
              </h2>

              {(grupos.get(clave) ?? []).map((heat) => (
                <div key={heat.id} className="relative">
                  <HeatCard
                    eventId={eventId}
                    timezone={timezone}
                    heat={heat}
                    teams={opciones}
                    judges={judges}
                    canManage={canManage}
                    canVerify={canVerify}
                  />
                  {canManage && heat.started_at === null && (
                    <div className="absolute top-4 right-4">
                      <QuitarHeat eventId={eventId} heat={heat} quitarHeat={quitarHeat} />
                    </div>
                  )}
                </div>
              ))}
            </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Quitar un heat, con confirmacion.
 *
 * ANTES DISPARABA LA ACCION DIRECTO AL CLICK. Solo se ofrece cuando el heat
 * todavia no largo (ver el llamador), asi que no destruye ningun tiempo — pero
 * SI borra la asignacion de equipos y jueces que el organizador ya armo, y el
 * boton "✕" vive pegado a la esquina de la tarjeta sin ningun otro control
 * cerca: un toque desviado en celular lo alcanza sin querer.
 */
function QuitarHeat({
  eventId,
  heat,
  quitarHeat,
}: {
  eventId: string;
  heat: HeatWithLanes;
  quitarHeat: AccionQuitar;
}) {
  const [confirmar, setConfirmar] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmar(true)}
        title="Quitar heat"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-sm text-neutral-700 hover:bg-neutral-900 hover:text-red-400"
      >
        ✕
      </button>

      <Modal
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="Quitar heat"
        ancho="max-w-sm"
      >
        <div className="text-left">
          <p className="text-sm text-neutral-300">
            ¿Quitar <span className="font-medium">{heat.name}</span>? Se borra junto con los
            equipos y jueces ya asignados a sus carriles. Esta acción no se puede deshacer.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton variante="secondary" compacto onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
            <FormularioDeEstado
              accion={quitarHeat.bind(null, eventId, heat.id)}
              estadoInicial={{ error: null }}
              etiqueta="Quitar heat"
              mensajeDeCarga="Quitando el heat…"
              className={claseDeBoton({ variante: "destructive", compacto: true })}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
