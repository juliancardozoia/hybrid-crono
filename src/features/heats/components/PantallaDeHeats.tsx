"use client";

import { useMemo, useState } from "react";
import { HeatCard, type TeamOption } from "./HeatCard";
import { NuevoHeat } from "./NuevoHeat";
import { DistribuirHeats } from "./DistribuirHeats";
import { Pestanas } from "./PestanasDePrueba";
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
  etapasConfirmadas,
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
  pruebas: Array<{ id: string; name: string; stage: number }>;
  /** Etapas (`workouts.stage`) con AL MENOS un `stage_advancements` cargado
   *  para este evento — o sea, con su corte ya confirmado. La primera etapa
   *  no depende de esto (ver más abajo). */
  etapasConfirmadas: number[];
  heats: HeatWithLanes[];
  opciones: TeamOption[];
  judges: JudgeOption[];
  canManage: boolean;
  canVerify: boolean;
  quitarHeat: AccionQuitar;
}) {
  const confirmadas = useMemo(() => new Set(etapasConfirmadas), [etapasConfirmadas]);

  // La primera etapa siempre está disponible, tenga la competencia una sola
  // etapa o varias: es el punto de partida, no depende de ningún corte. Una
  // etapa posterior (semifinal, final) solo se habilita cuando YA se
  // confirmó el corte que decide quién llega a ella — antes de eso no hay
  // ningún equipo elegible (`auto_distribuir_heats`/`assign_heat_lanes` ya lo
  // exigen del lado de la base) y ofrecer la pestaña sería invitar a un
  // "distribuir" que no va a asignar a nadie.
  const primeraEtapa = useMemo(
    () => Math.min(...pruebas.map((p) => p.stage), 1),
    [pruebas],
  );

  const etapas = useMemo(() => {
    const todas = [...new Set(pruebas.map((p) => p.stage))].sort((a, b) => a - b);
    return todas.filter((e) => e === primeraEtapa || confirmadas.has(e));
  }, [pruebas, primeraEtapa, confirmadas]);
  const variasEtapas = etapas.length > 1;
  const [etapaActiva, setEtapaActiva] = useState(primeraEtapa);

  // Ajuste durante el RENDER, no en un efecto — mismo patrón que
  // `heatSembrado` en HeatCard.tsx: React 19 rechaza un `setState` sincrono
  // dentro de un `useEffect` (ver CLAUDE.md), y esto no es una suscripcion a
  // nada externo, es corregir una seleccion que dejo de ser valida cuando
  // `etapas` cambia (por ejemplo, se confirma un corte y aparece una etapa
  // nueva).
  if (!etapas.includes(etapaActiva)) {
    setEtapaActiva(etapas[0] ?? primeraEtapa);
  }

  // Las pruebas de la etapa elegida. Se filtra SIEMPRE por `etapaActiva` —no
  // solo con varias etapas visibles— porque `pruebas` puede traer WODs de una
  // etapa futura que ya existen en la base pero cuyo corte todavía no se
  // confirmó: esos no tienen que aparecer en ningún lado hasta que su
  // pestaña se habilite.
  const pruebasDeEtapa = useMemo(
    () => pruebas.filter((p) => p.stage === etapaActiva),
    [pruebas, etapaActiva],
  );

  const [divisionId, setDivisionId] = useState("");
  const [workoutId, setWorkoutId] = useState("");

  // Arranca en la primera prueba de la etapa activa, y se reacomoda cada vez
  // que `workoutId` deja de pertenecer a `pruebasDeEtapa` — no solo cuando
  // hay mas de una. Tambien ajustado durante el render, mismo motivo de
  // arriba.
  //
  // BUG REAL: la condicion decia `pruebasDeEtapa.length > 1`. Con una etapa
  // de UNA sola prueba (nada raro: una semifinal suele ser un unico WOD),
  // `workoutId` se quedaba con el id de la prueba de la etapa ANTERIOR — y
  // como `visibles` exige `h.workout_id === workoutId` ademas de pertenecer a
  // la etapa, ningun heat de esa prueba coincidia nunca: la pantalla decia
  // "ningun heat coincide con el filtro" con los heats bien armados en la
  // base. Sin el minimo de dos pruebas, se corrige siempre que corresponda.
  if (pruebasDeEtapa.length > 0 && !pruebasDeEtapa.some((p) => p.id === workoutId)) {
    setWorkoutId(pruebasDeEtapa[0]!.id);
  }

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

  const variasPruebas = pruebasDeEtapa.length > 1;

  // "Distribuir automáticamente" y "Crear heat" solo tienen sentido en la
  // etapa EN CURSO — la más alta de las habilitadas, nunca una ya pasada.
  //
  // BUG REPORTADO: con "etapaActiva === primeraEtapa || confirmadas.has(...)"
  // los botones seguían apareciendo en la etapa 1 aunque el corte de la
  // etapa 2 ya estuviera confirmado — esa condición nunca deja de ser cierta
  // para la etapa 1 una vez que existe, así que quedaba habilitada para
  // siempre. Una vez que se confirma el corte hacia la etapa 2, la etapa 1
  // ya se corrió y cerró: no hay nada que distribuir ni ningún heat nuevo
  // que crear ahí. Lo correcto es comparar contra la ÚLTIMA etapa habilitada
  // (`etapas` ya solo contiene la primera + las que tienen corte confirmado,
  // en orden), que es la que sigue "abierta" para operar.
  const puedeGestionarEtapaActiva = etapaActiva === etapas[etapas.length - 1];

  // Solo se ofrecen las categorías que ya tienen algún heat: elegir una
  // vacía en el filtro solo mostraría "sin heats todavía" sin decir por qué.
  const divisionesConHeat = useMemo(() => {
    const ids = new Set(heats.map((h) => h.division_id).filter((x): x is string => Boolean(x)));
    return divisiones.filter((d) => ids.has(d.id));
  }, [divisiones, heats]);

  // Los ids de prueba de la etapa activa. `pruebasDeEtapa` ya filtra por
  // `etapaActiva` siempre (ver arriba), así que este set alcanza para no
  // mezclar heats de otra etapa aunque `workoutId` quede vacío por tener una
  // sola prueba en la etapa.
  const idsDeEtapa = useMemo(() => new Set(pruebasDeEtapa.map((p) => p.id)), [pruebasDeEtapa]);

  // Memoizado, y no un `.filter` suelto: `grupos` cuelga de esta referencia, y
  // un arreglo nuevo en cada render dejaría su useMemo sin efecto.
  const visibles = useMemo(
    () =>
      heats.filter(
        (h) =>
          (!divisionId || h.division_id === divisionId) &&
          idsDeEtapa.has(h.workout_id) &&
          (!workoutId || h.workout_id === workoutId),
      ),
    [heats, divisionId, workoutId, idsDeEtapa],
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
      {variasEtapas && (
        <Pestanas
          items={etapas.map((e) => ({ id: String(e), label: `Etapa ${e}` }))}
          activa={String(etapaActiva)}
          onCambiar={(id) => setEtapaActiva(Number(id))}
          variante="principal"
        />
      )}

      {variasPruebas && (
        <Pestanas
          items={pruebasDeEtapa.map((p) => ({ id: p.id, label: p.name }))}
          activa={workoutId}
          onCambiar={setWorkoutId}
        />
      )}

      {/* Una sola fila, a todo el ancho: el filtro a la izquierda, las dos
          acciones de alta a la derecha. En celular se apila. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
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

        {canManage && puedeGestionarEtapaActiva && (
          <div className="flex flex-wrap items-center gap-3">
            <DistribuirHeats eventId={eventId} pruebas={pruebasDeEtapa} />
            <NuevoHeat eventId={eventId} divisiones={divisiones} pruebas={pruebasDeEtapa} />
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
        <div className="flex flex-col gap-4">
          {clavesOrdenadas.map((clave) => {
            const [claveWorkout, claveDivision] = clave.split("|");
            const categoria = claveDivision
              ? (nombreDivision.get(claveDivision) ?? "Categoría")
              : "Sin categoría";
            const heatsDelGrupo = grupos.get(clave) ?? [];

            // Abierto de entrada solo si no hay nada más para elegir: un
            // filtro de categoría ya explícito, o un único grupo. Con varias
            // categorías a la vista y muchos atletas por categoría (muchos
            // heats cada una), abrirlas todas de una es la lista larguísima
            // que se pedía evitar — colapsadas, el título ya dice cuántos
            // heats tiene cada una sin obligar a leerlos.
            const abiertoPorDefecto = Boolean(divisionId) || clavesOrdenadas.length === 1;

            return (
              <details key={clave} className="group" open={abiertoPorDefecto}>
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-neutral-800 px-4 py-3 select-none hover:border-neutral-700">
                  <span className="text-neutral-600 transition-transform group-open:rotate-90">
                    ▶
                  </span>
                  <h2 className="flex-1 text-sm font-semibold tracking-wide text-neutral-300">
                    {/* El nombre de la prueba solo aparece cuando hay más de
                        una: en una carrera híbrida repetir "Circuito" arriba
                        de cada grupo es ruido que no distingue nada. */}
                    {variasPruebas && (
                      <span className="text-lime-400">
                        {nombrePrueba.get(claveWorkout) ?? "Prueba"}
                        <span className="mx-2 text-neutral-700">·</span>
                      </span>
                    )}
                    {categoria}
                  </h2>
                  <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-neutral-500">
                    {heatsDelGrupo.length} heat{heatsDelGrupo.length === 1 ? "" : "s"}
                  </span>
                </summary>

                <div className="mt-4 flex flex-col gap-4 pl-1">
                  {heatsDelGrupo.map((heat) => (
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
                </div>
              </details>
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
