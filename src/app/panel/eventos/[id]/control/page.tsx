import Link from "next/link";
import { redirect } from "next/navigation";
import { getDivisions, getHeats, getJudges } from "@/features/events/config/queries";
import { getEtapasConCorteConfirmado, getPruebas } from "@/features/workouts/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import {
  cancelHeatStart,
  marcarDnf,
  startHeat,
  type FormState,
} from "@/features/heats/actions";
import { estaPendienteDeVerificar } from "@/features/verification/lib/estado";
import { getVerificationQueue } from "@/features/verification/queries";
import { TorreDeHeats, type HeatVista } from "@/features/heats/components/TorreDeHeats";

export const dynamic = "force-dynamic";

export default async function ControlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event, canVerify } = await requireEventAccess(id);

  if (!canVerify) redirect(`/panel/eventos/${id}`);

  const [heats, cola, judges, divisiones, pruebas, etapasConfirmadas] = await Promise.all([
    getHeats(id),
    getVerificationQueue(id),
    getJudges(id),
    getDivisions(id),
    getPruebas(id),
    getEtapasConCorteConfirmado(id),
  ]);

  const porCarril = new Map(cola.map((c) => [c.laneId, c]));
  const porJuez = new Map(judges.map((j) => [j.userId, j.label]));
  const nombreDivision = new Map(divisiones.map((d) => [d.id, d.name]));

  // Mismo patron que /heats: el nombre de la prueba se trae plano y se une en
  // memoria, sin agregar un embed `workouts (name)` al ya pesado `getHeats`.
  const nombresDePruebas = pruebas.map(({ workout }) => ({
    id: workout.id,
    name: workout.name,
    stage: workout.stage,
  }));

  const sinJuez = heats.flatMap((h) =>
    h.lanes.filter((l) => l.team_id && !l.judge_id),
  ).length;
  // "Para revisar" son carriles que pintan MAL: un marcaje fuera de orden, un
  // split sospechosamente corto, un marcaje anulado. Cero aca no quiere decir
  // que el evento este listo, quiere decir que nada parece roto.
  const conAnomalias = cola.filter(
    (c) => c.anomalies.length > 0 || c.voidedCount > 0,
  ).length;
  const sinMarcajes = cola.filter((c) => c.eventCount === 0).length;

  // Lo que si dice cuanto falta para cerrar el evento. Sin este numero, un
  // "0 para revisar" se lee como "no queda nada por hacer", que es justo lo
  // contrario de lo que pasa cuando un atleta acaba de terminar.
  const sinVerificar = cola.filter(estaPendienteDeVerificar).length;

  // La pregunta que "0 para revisar" tampoco contesta: que esta pasando AHORA
  // MISMO. Sin este numero, saberlo obliga a leer la lista entera de heats.
  const enCursoAhora = heats.filter((h) => h.started_at && !h.ended_at).length;

  // Un solo arreglo de datos ya resueltos, sin Maps: cruza la frontera hacia
  // el componente de cliente que arma la lista (filtro por division, reloj en
  // vivo, DNF). Los Maps se resuelven aca porque no viajan bien a traves de
  // esa frontera, y porque es el unico lugar que ya tiene RLS de su lado.
  const heatsVista: HeatVista[] = heats.map((heat) => {
    const marcajesDelHeat = heat.lanes.reduce(
      (n, l) => n + (porCarril.get(l.id)?.eventCount ?? 0),
      0,
    );
    const conAtleta = heat.lanes.filter((l) => l.team_id !== null);

    return {
      id: heat.id,
      name: heat.name,
      startedAt: heat.started_at,
      endedAt: heat.ended_at,
      startSource: heat.start_source,
      divisionId: heat.division_id,
      divisionName: heat.division_id ? (nombreDivision.get(heat.division_id) ?? null) : null,
      workoutId: heat.workout_id,
      workoutName: nombresDePruebas.find((p) => p.id === heat.workout_id)?.name ?? null,
      marcajesTotales: marcajesDelHeat,
      conAtletaCount: conAtleta.length,
      sinJuezCount: conAtleta.filter((l) => l.judge_id === null).length,
      lanes: heat.lanes.map((lane) => {
        const info = porCarril.get(lane.id);
        const estado = info?.status ?? lane.status;
        const terminado = estado === "finished" || estado === "dnf" || estado === "dq";

        return {
          laneId: lane.id,
          laneNumber: lane.lane_number,
          bib: lane.bib,
          athletes: lane.athletes,
          teamLabel: lane.teamLabel,
          judgeId: lane.judge_id,
          judgeName: lane.judge_id ? (porJuez.get(lane.judge_id) ?? "asignado") : null,
          status: estado,
          totalMs: info?.totalMs ?? null,
          eventCount: info?.eventCount ?? 0,
          puedeMarcarDnf: Boolean(
            lane.team_id && heat.started_at && !heat.ended_at && !terminado,
          ),
        };
      }),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      {/* "En curso ahora" primero: es la pregunta que un operador hace apenas
          entra, antes que ninguna otra. Tres por fila en celular, cinco en
          desktop — con cinco tarjetas en dos columnas la ultima quedaba sola
          y desalineada. */}
      <section className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-5">
        <Indicador
          valor={enCursoAhora}
          etiqueta="en curso ahora"
          // No es una alerta: que haya heats corriendo es lo normal durante
          // el evento. Se destaca en lima, no en ambar, cuando hay algo — el
          // mismo criterio de color que ya usa "EN CURSO" en cada tarjeta.
          alerta={false}
          destacar={enCursoAhora > 0}
        />
        <Indicador
          valor={sinJuez}
          etiqueta="carriles sin juez"
          alerta={sinJuez > 0}
          href={sinJuez > 0 ? `/panel/eventos/${id}/heats` : undefined}
        />
        <Indicador
          valor={sinMarcajes}
          etiqueta="sin marcajes"
          alerta={sinMarcajes > 0}
          href={sinMarcajes > 0 ? `/panel/eventos/${id}/verificacion` : undefined}
        />
        <Indicador
          valor={conAnomalias}
          etiqueta="con anomalías"
          alerta={conAnomalias > 0}
          href={conAnomalias > 0 ? `/panel/eventos/${id}/verificacion` : undefined}
        />
        <Indicador
          valor={sinVerificar}
          etiqueta="sin verificar"
          alerta={sinVerificar > 0}
          href={`/panel/eventos/${id}/verificacion`}
        />
      </section>

      <TorreDeHeats
        eventId={id}
        timezone={event.timezone}
        formato={event.format}
        divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
        pruebas={nombresDePruebas}
        etapasConfirmadas={[...etapasConfirmadas]}
        heats={heatsVista}
        largar={largar}
        deshacer={deshacer}
        marcarDnfAccion={marcarDnfAccion}
      />
    </div>
  );
}

function Indicador({
  valor,
  etiqueta,
  alerta,
  destacar = false,
  href,
}: {
  valor: number;
  etiqueta: string;
  alerta: boolean;
  /** Distinto de `alerta`: no es un problema, es actividad normal que
   *  conviene notar (heats en curso). Se destaca en lima, nunca en ambar —
   *  el mismo color que ya usa el badge "EN CURSO" de cada tarjeta. */
  destacar?: boolean;
  /** Si el numero se puede accionar, la tarjeta lleva ahi. */
  href?: string;
}) {
  const Caja = href ? Link : "div";
  const tono = alerta ? "amber" : destacar ? "lime" : null;

  return (
    <Caja
      href={href!}
      className={`block rounded-2xl border p-3 text-center sm:p-4 ${
        tono === "amber"
          ? "border-amber-500/40 bg-amber-500/10"
          : tono === "lime"
            ? "border-lime-500/30 bg-lime-500/5"
            : "border-neutral-800"
      } ${href ? "transition-colors hover:border-neutral-600" : ""}`}
    >
      <p
        className={`font-mono text-2xl font-black tabular-nums sm:text-3xl ${
          tono === "amber" ? "text-amber-300" : tono === "lime" ? "text-lime-400" : "text-neutral-600"
        }`}
      >
        {valor}
      </p>
      <p className="mt-1 text-[11px] leading-tight text-neutral-500 sm:text-xs">
        {etiqueta}
      </p>
    </Caja>
  );
}

async function largar(
  eventId: string,
  heatId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return startHeat(eventId, heatId);
}

async function deshacer(
  eventId: string,
  heatId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return cancelHeatStart(eventId, heatId);
}

async function marcarDnfAccion(
  eventId: string,
  laneId: string,
  _prev: FormState,
  _formData: FormData,
) {
  "use server";
  return marcarDnf(eventId, laneId);
}
