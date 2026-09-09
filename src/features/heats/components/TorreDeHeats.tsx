"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventFormat } from "@/lib/supabase/types";
import { formatElapsed } from "@/shared/timing/clock";
import { horaEnEvento } from "@/shared/utils/fecha";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { Boton, claseDeBoton } from "@/shared/components/Boton";
import { Selector } from "@/shared/components/Selector";
import { Modal } from "@/shared/components/Modal";
import { RelojDeHeat } from "./RelojDeHeat";

export interface CarrilVista {
  laneId: string;
  laneNumber: number;
  bib: number | null;
  athletes: string | null;
  teamLabel: string | null;
  judgeId: string | null;
  judgeName: string | null;
  status: string;
  totalMs: number | null;
  eventCount: number;
  /** Tiene atleta, el heat largó y todavía no está en un estado terminal. */
  puedeMarcarDnf: boolean;
}

export interface HeatVista {
  id: string;
  name: string;
  startedAt: string | null;
  endedAt: string | null;
  startSource: string | null;
  divisionId: string | null;
  divisionName: string | null;
  workoutId: string;
  workoutName: string | null;
  marcajesTotales: number;
  conAtletaCount: number;
  sinJuezCount: number;
  lanes: CarrilVista[];
}

interface FormState {
  error: string | null;
}

type AccionHeat = (
  eventId: string,
  heatId: string,
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

type AccionCarril = (
  eventId: string,
  laneId: string,
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

/**
 * La torre de heats de la pantalla de control: filtro por categoría, reloj
 * en vivo del heat en curso, hora de cierre una vez termina, y DNF por
 * carril.
 *
 * ES UN COMPONENTE DE CLIENTE porque el filtro y el reloj en vivo lo
 * necesitan. Los datos ya vienen resueltos en un arreglo plano desde el
 * servidor —sin Maps, que no cruzan bien esa frontera— porque page.tsx ya
 * tiene ahí mismo RLS de su lado y no hay motivo para repetir esas consultas
 * en el cliente.
 */
export function TorreDeHeats({
  eventId,
  timezone,
  formato,
  divisiones,
  pruebas,
  heats,
  largar,
  deshacer,
  marcarDnfAccion,
}: {
  eventId: string;
  timezone: string;
  /** Decide como se nombra un carril "en carrera": una carrera hibrida corre,
   *  un CrossFit trabaja un WOD — la misma palabra no sirve para los dos. */
  formato: EventFormat;
  divisiones: Array<{ id: string; name: string }>;
  /** En el orden en que corren. Con una sola, la pantalla no la menciona —
   *  mismo criterio que ya usa /heats. */
  pruebas: Array<{ id: string; name: string }>;
  heats: HeatVista[];
  largar: AccionHeat;
  deshacer: AccionHeat;
  marcarDnfAccion: AccionCarril;
}) {
  const [divisionId, setDivisionId] = useState("");
  const [workoutId, setWorkoutId] = useState("");
  const router = useRouter();

  // Sin esto, un DNF marcado desde el celular del juez -o cualquier otro
  // cambio de estado- no aparece acá hasta que alguien recarga la página a
  // mano: esta pantalla es una foto del servidor, no se refresca sola. Solo
  // mientras haya algo corriendo, para no pedirle al servidor cada 15s una
  // torre de control vacía.
  const hayHeatCorriendo = heats.some((h) => h.startedAt && !h.endedAt);
  useEffect(() => {
    if (!hayHeatCorriendo) return;
    const timer = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(timer);
  }, [hayHeatCorriendo, router]);

  const divisionesConHeat = useMemo(() => {
    const ids = new Set(heats.map((h) => h.divisionId).filter((x): x is string => Boolean(x)));
    return divisiones.filter((d) => ids.has(d.id));
  }, [divisiones, heats]);

  const variasPruebas = pruebas.length > 1;
  const nombrePrueba = useMemo(() => new Map(pruebas.map((p) => [p.id, p.name])), [pruebas]);
  const ordenPrueba = useMemo(() => new Map(pruebas.map((p, i) => [p.id, i])), [pruebas]);

  const visibles = useMemo(
    () =>
      heats.filter(
        (h) =>
          (!divisionId || h.divisionId === divisionId) &&
          (!workoutId || h.workoutId === workoutId),
      ),
    [heats, divisionId, workoutId],
  );

  // Agrupado por PRUEBA y CATEGORIA, mismo patron que /heats: en un CrossFit
  // multi-WOD, "que esta pasando en el WOD 2" es la pregunta real y una lista
  // plana de quince heats no la contesta sin leerla entera.
  const grupos = useMemo(() => {
    const mapa = new Map<string, HeatVista[]>();
    for (const heat of visibles) {
      const clave = `${heat.workoutId}|${heat.divisionId ?? ""}`;
      mapa.set(clave, [...(mapa.get(clave) ?? []), heat]);
    }
    return mapa;
  }, [visibles]);

  const clavesOrdenadas = useMemo(
    () =>
      [...grupos.keys()].sort((a, b) => {
        const [wa, da] = a.split("|");
        const [wb, db] = b.split("|");
        const porPrueba = (ordenPrueba.get(wa) ?? 0) - (ordenPrueba.get(wb) ?? 0);
        if (porPrueba !== 0) return porPrueba;
        if (da === "") return 1;
        if (db === "") return -1;
        const nombreDivision = new Map(divisiones.map((d) => [d.id, d.name]));
        return (nombreDivision.get(da) ?? "").localeCompare(nombreDivision.get(db) ?? "");
      }),
    [grupos, ordenPrueba, divisiones],
  );

  return (
    <div className="flex flex-col gap-4">
      {(variasPruebas || divisionesConHeat.length > 1) && (
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
      )}

      {visibles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          {heats.length === 0 ? "No hay heats armados todavía." : "Ningún heat coincide con el filtro."}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {clavesOrdenadas.map((clave) => {
            const [claveWorkout, claveDivision] = clave.split("|");
            const categoria = claveDivision
              ? (divisiones.find((d) => d.id === claveDivision)?.name ?? "Categoría")
              : "Sin categoría";

            // Solo se muestra un encabezado si agrega informacion: con una
            // sola prueba y una sola categoria, la lista plana de antes ya
            // decia todo lo que hacia falta y un encabezado repetido en cada
            // heat era ruido.
            const mostrarEncabezado = variasPruebas || divisionesConHeat.length > 1;

            return (
              <section key={clave} className="flex flex-col gap-4">
                {mostrarEncabezado && (
                  <h2 className="text-sm font-semibold tracking-wide text-neutral-400 uppercase">
                    {variasPruebas && (
                      <>
                        <span className="text-lime-400">
                          {nombrePrueba.get(claveWorkout) ?? "Prueba"}
                        </span>
                        <span className="mx-2 text-neutral-700">·</span>
                      </>
                    )}
                    {categoria}
                  </h2>
                )}

                {(grupos.get(clave) ?? []).map((heat) => (
                  <TarjetaDeHeat
                    key={heat.id}
                    eventId={eventId}
                    timezone={timezone}
                    formato={formato}
                    heat={heat}
                    largar={largar}
                    deshacer={deshacer}
                    marcarDnfAccion={marcarDnfAccion}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TarjetaDeHeat({
  eventId,
  timezone,
  formato,
  heat,
  largar,
  deshacer,
  marcarDnfAccion,
}: {
  eventId: string;
  timezone: string;
  formato: EventFormat;
  heat: HeatVista;
  largar: AccionHeat;
  deshacer: AccionHeat;
  marcarDnfAccion: AccionCarril;
}) {
  const enCurso = Boolean(heat.startedAt) && !heat.endedAt;

  return (
    // El heat en curso se distingue por borde y fondo, ademas del badge — no
    // solo por texto o por detectar que el reloj se mueve. Es la UNICA
    // tarjeta que lleva este acento a la vez, asi que no convierte toda la
    // pantalla en color: el resto se queda en el gris neutral de siempre.
    <section
      className={`rounded-2xl border p-4 sm:p-5 ${
        enCurso ? "border-lime-500/40 bg-lime-500/5" : "border-neutral-800"
      }`}
    >
      {/*
        En celular el titulo y la accion van apilados, y el boton ocupa el
        ancho completo. Antes compartian una fila con flex-wrap y el boton
        quedaba flotando al medio, sin alinearse ni a un lado ni al otro.
      */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 font-semibold">
            {heat.name}
            {heat.divisionName && (
              <span className="text-xs font-normal text-neutral-500">{heat.divisionName}</span>
            )}
            {enCurso && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-lime-500/40 bg-lime-500/10 px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-lime-400 uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
                En curso
              </span>
            )}
          </h2>
          <p className="text-sm text-neutral-500">
            {!heat.startedAt ? (
              "Sin iniciar"
            ) : heat.endedAt ? (
              // Se conservan LAS DOS fechas: antes esta rama solo mostraba
              // "Finalizó", y la hora de inicio desaparecia de la pantalla
              // en cuanto el heat cerraba, aunque el dato siguiera ahi.
              <>
                Inició {horaEnEvento(heat.startedAt, timezone)} · Finalizó{" "}
                {horaEnEvento(heat.endedAt, timezone)}
              </>
            ) : (
              <>
                Inició {horaEnEvento(heat.startedAt, timezone)} ·{" "}
                <RelojDeHeat startedAtIso={heat.startedAt} className="font-mono text-lime-400" />
              </>
            )}
            {heat.startSource === "device_offline" && (
              <span className="ml-2 text-amber-400">salida provisional</span>
            )}
          </p>
        </div>

        {!heat.startedAt ? (
          <LargarHeat eventId={eventId} heat={heat} largar={largar} />
        ) : (
          heat.marcajesTotales === 0 && (
            // Todavia no llego ningun marcaje: se puede deshacer sin
            // destruir tiempos de nadie.
            <div className="shrink-0">
              <DeshacerInicio eventId={eventId} heat={heat} deshacer={deshacer} />
            </div>
          )
        )}
      </header>

      {/*
        Cada carril es una fila de tres columnas fijas: numero, quien
        corre y su juez, y el estado. Las dos celdas de texto van en dos
        lineas para no pelear por el ancho, asi la tabla se lee igual en
        un celular de 360px que en una pantalla grande.
      */}
      <ul className="mt-4 divide-y divide-neutral-800">
        {heat.lanes.map((lane) => {
          const tieneTiempo = lane.totalMs !== null;

          return (
            <li key={lane.laneId} className="flex items-center gap-3 py-3">
              <span className="w-6 shrink-0 text-center font-mono text-sm text-neutral-600">
                {lane.laneNumber}
              </span>

              <div className="min-w-0 flex-1">
                {/*
                  Quien corre va primero y con el dorsal al lado. Antes
                  estaba solo el dorsal y debajo el juez, y como el juez a
                  veces aparece con su email, un numero sobre un email se
                  leia como si el email fuera del atleta.
                */}
                <p className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-bold tabular-nums text-neutral-300">
                    {lane.bib !== null ? `#${lane.bib}` : "—"}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {lane.athletes ?? lane.teamLabel ?? (
                      <span className="text-neutral-600">carril libre</span>
                    )}
                  </span>
                </p>
                <p className="truncate text-xs">
                  {lane.judgeId ? (
                    <span className="text-neutral-500">Juez: {lane.judgeName}</span>
                  ) : (
                    <span className="text-amber-400">sin juez</span>
                  )}
                  {lane.athletes && lane.teamLabel && (
                    <span className="text-neutral-600"> · {lane.teamLabel}</span>
                  )}
                </p>
              </div>

              {lane.puedeMarcarDnf && (
                <ConfirmarDnf eventId={eventId} lane={lane} marcarDnfAccion={marcarDnfAccion} />
              )}

              <div className="shrink-0 text-right">
                <p className="font-mono text-sm tabular-nums">
                  {tieneTiempo ? (
                    formatElapsed(lane.totalMs!)
                  ) : (
                    <EstadoCarril estado={lane.status} formato={formato} />
                  )}
                </p>
                <p className="text-xs text-neutral-600">
                  {lane.eventCount > 0 || lane.status !== "idle"
                    ? `${lane.eventCount} marcajes`
                    : "sin datos"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {enCurso && (
        <p className="mt-3 text-xs text-neutral-600">
          El reloj sigue mientras el heat esté en curso. Cierra solo cuando todos los carriles con
          atleta terminan, capean o quedan en DNF/DQ.
        </p>
      )}
    </section>
  );
}

/**
 * El boton DNF de cada carril, con confirmacion.
 *
 * ANTES DISPARABA LA ACCION DIRECTO AL CLICK — a diferencia de "Deshacer
 * Inicio" y "Largar Heat", que ya pedian confirmar. Un DNF es tan
 * irreversible como esos dos (congela el reloj del atleta para siempre, via
 * el mismo camino que el DNF del propio juez) y un click accidental en una
 * fila apretada de carriles no puede tener el mismo costo que abrir un menu.
 */
function ConfirmarDnf({
  eventId,
  lane,
  marcarDnfAccion,
}: {
  eventId: string;
  lane: CarrilVista;
  marcarDnfAccion: AccionCarril;
}) {
  const [confirmar, setConfirmar] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmar(true)}
        title="Marcar como no presentado / no terminó"
        className="shrink-0 rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-400 hover:border-red-500/40 hover:text-red-300"
      >
        DNF
      </button>

      <Modal
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="Marcar DNF"
        ancho="max-w-sm"
      >
        <div className="text-left">
          <p className="text-sm text-neutral-300">
            ¿Marcar a{" "}
            <span className="font-medium">
              {lane.athletes ?? lane.teamLabel ?? `carril ${lane.laneNumber}`}
            </span>{" "}
            como no presentado / no terminó? El reloj de ese carril se congela y esta acción no
            se puede deshacer.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton variante="secondary" compacto onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
            <FormularioDeEstado
              accion={marcarDnfAccion.bind(null, eventId, lane.laneId)}
              estadoInicial={{ error: null }}
              etiqueta="Confirmar DNF"
              mensajeDeCarga="Marcando DNF…"
              className={claseDeBoton({ variante: "destructive", compacto: true })}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * "Deshacer Inicio", con confirmacion.
 *
 * ANTES DISPARABA LA ACCION DIRECTO AL CLICK, sin nada de por medio — a
 * diferencia de otros botones destructivos de la app (ver "Eliminar
 * categoría" en `ParametrosDeCategoria.tsx`), que siempre piden confirmar en
 * un segundo paso. Un click accidental reiniciaba el heat sin aviso.
 *
 * Solo aparece cuando `heat.marcajesTotales === 0` (ver el llamador), asi que
 * deshacer nunca destruye un tiempo ya tomado — el riesgo real es reiniciar
 * un heat que en realidad SI arranco, no perder datos.
 */
function DeshacerInicio({
  eventId,
  heat,
  deshacer,
}: {
  eventId: string;
  heat: HeatVista;
  deshacer: AccionHeat;
}) {
  const [confirmar, setConfirmar] = useState(false);

  return (
    <>
      {/* variante secondary normaliza el texto a `text-neutral-100` (antes
          era `text-neutral-400`, mas apagado) — no se fuerza el color por
          className, que competiria con el que ya trae la variante. Es la
          misma normalizacion que ya se acepto en el resto del lote. */}
      <Boton
        variante="secondary"
        compacto
        className="w-full sm:w-auto"
        onClick={() => setConfirmar(true)}
      >
        Deshacer Inicio
      </Boton>

      <Modal
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="Deshacer inicio"
        ancho="max-w-sm"
      >
        <div className="text-left">
          <p className="text-sm text-neutral-300">
            ¿Deshacer el inicio de <span className="font-medium">{heat.name}</span>? El heat vuelve
            a quedar sin iniciar y se puede largar de nuevo cuando corresponda.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton variante="secondary" compacto onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
            <FormularioDeEstado
              accion={deshacer.bind(null, eventId, heat.id)}
              estadoInicial={{ error: null }}
              etiqueta="Deshacer Inicio"
              mensajeDeCarga="Deshaciendo el inicio del heat…"
              className={claseDeBoton({ variante: "destructive", compacto: true })}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * Boton de largada, con confirmacion.
 *
 * Se deshabilita hasta que TODOS los carriles con atleta tengan juez. La base lo
 * rechaza igual, pero un boton gris que dice por que es mucho mejor que un
 * click que falla en silencio: es la regla de la competencia, no un capricho de
 * la app. Ningun atleta corre sin alguien que le tome los parciales.
 *
 * PIDE CONFIRMAR. Antes disparaba la largada directo al click — a diferencia de
 * "Deshacer Inicio" y el DNF, que ya pedian un segundo paso. Largar un heat es
 * tan dificil de revertir como esos dos (solo se puede deshacer mientras nadie
 * marco nada) y esta al lado de la lista de carriles, en la misma tarjeta que
 * el organizador toca para revisar quien falta: un click apenas desviado larga
 * la carrera de verdad.
 */
function LargarHeat({
  eventId,
  heat,
  largar,
}: {
  eventId: string;
  heat: HeatVista;
  largar: AccionHeat;
}) {
  const listo = heat.conAtletaCount > 0 && heat.sinJuezCount === 0;
  const [confirmar, setConfirmar] = useState(false);

  return (
    // En celular ocupa el ancho completo y el texto va alineado a la izquierda,
    // como el resto de la tarjeta. Recien en pantalla ancha se va a la derecha.
    <div className="shrink-0 sm:max-w-[17rem] sm:text-right">
      <Boton className="w-full sm:w-auto" onClick={() => setConfirmar(true)} disabled={!listo}>
        INICIAR HEAT
      </Boton>
      {!listo && (
        <p className="mt-2 text-xs text-amber-400">
          {heat.conAtletaCount === 0
            ? "Este heat no tiene atletas en sus carriles."
            : `Faltan ${heat.sinJuezCount} juez/jueces: cada atleta necesita el suyo antes de iniciar.`}
        </p>
      )}

      <Modal
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="Largar heat"
        ancho="max-w-sm"
      >
        <div className="text-left">
          <p className="text-sm text-neutral-300">
            ¿Largar <span className="font-medium">{heat.name}</span>? El reloj arranca para todos
            los carriles con atleta y esta acción no se puede deshacer una vez que alguien marque
            un tiempo.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton variante="secondary" compacto onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
            <FormularioDeEstado
              accion={largar.bind(null, eventId, heat.id)}
              estadoInicial={{ error: null }}
              etiqueta="Confirmar largada"
              mensajeDeCarga="Largando el heat…"
              className={claseDeBoton({ variante: "primary", compacto: true })}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function EstadoCarril({
  estado,
  formato,
}: {
  estado: string;
  formato: EventFormat;
}) {
  const copy: Record<string, { texto: string; clase: string }> = {
    idle: { texto: "esperando", clase: "text-neutral-600" },
    // "en carrera" describe un circuito; un WOD no se "corre", se trabaja.
    running: {
      texto: formato === "crossfit" ? "en el WOD" : "en carrera",
      clase: "text-lime-400",
    },
    finished: { texto: "terminó", clase: "text-emerald-400" },
    dnf: { texto: "DNF", clase: "text-neutral-500" },
    dq: { texto: "DQ", clase: "text-red-400" },
  };
  const c = copy[estado] ?? { texto: estado, clase: "text-neutral-500" };
  return <span className={`text-xs ${c.clase}`}>{c.texto}</span>;
}
