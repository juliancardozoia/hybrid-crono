import Link from "next/link";
import { redirect } from "next/navigation";
import { getDivisions, getHeats, getJudges } from "@/features/events/config/queries";
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

  const [heats, cola, judges, divisiones] = await Promise.all([
    getHeats(id),
    getVerificationQueue(id),
    getJudges(id),
    getDivisions(id),
  ]);

  const porCarril = new Map(cola.map((c) => [c.laneId, c]));
  const porJuez = new Map(judges.map((j) => [j.userId, j.label]));
  const nombreDivision = new Map(divisiones.map((d) => [d.id, d.name]));

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
      {/* Dos por fila en celular: cuatro no entran legibles en 360px. */}
      <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Indicador
          valor={sinJuez}
          etiqueta="carriles sin juez"
          alerta={sinJuez > 0}
        />
        <Indicador
          valor={sinMarcajes}
          etiqueta="sin marcajes"
          alerta={sinMarcajes > 0}
        />
        <Indicador
          valor={conAnomalias}
          etiqueta="con anomalías"
          alerta={conAnomalias > 0}
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
        divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
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
  href,
}: {
  valor: number;
  etiqueta: string;
  alerta: boolean;
  /** Si el numero se puede accionar, la tarjeta lleva ahi. */
  href?: string;
}) {
  const Caja = href ? Link : "div";

  return (
    <Caja
      href={href!}
      className={`block rounded-2xl border p-3 text-center sm:p-4 ${
        alerta ? "border-amber-500/40 bg-amber-500/10" : "border-neutral-800"
      } ${href ? "transition-colors hover:border-neutral-600" : ""}`}
    >
      <p
        className={`font-mono text-2xl font-black tabular-nums sm:text-3xl ${
          alerta ? "text-amber-300" : "text-neutral-600"
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
