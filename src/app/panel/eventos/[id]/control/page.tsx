import Link from "next/link";
import { redirect } from "next/navigation";
import { formatElapsed } from "@/shared/timing/clock";
import { horaEnEvento } from "@/shared/utils/fecha";
import { getHeats, getJudges } from "@/features/events/config/queries";
import { requireEventAccess } from "@/features/events/lib/access";
import { cancelHeatStart, startHeat } from "@/features/heats/actions";
import { estaPendienteDeVerificar } from "@/features/verification/lib/estado";
import { getVerificationQueue } from "@/features/verification/queries";

export const dynamic = "force-dynamic";

export default async function ControlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { event, canVerify } = await requireEventAccess(id);

  if (!canVerify) redirect(`/panel/eventos/${id}`);

  const [heats, cola, judges] = await Promise.all([
    getHeats(id),
    getVerificationQueue(id),
    getJudges(event.org_id),
  ]);

  const porCarril = new Map(cola.map((c) => [c.laneId, c]));
  const porJuez = new Map(judges.map((j) => [j.userId, j.label]));

  const sinJuez = heats.flatMap((h) => h.lanes.filter((l) => l.team_id && !l.judge_id)).length;
  // "Para revisar" son carriles que pintan MAL: un marcaje fuera de orden, un
  // split sospechosamente corto, un marcaje anulado. Cero aca no quiere decir
  // que el evento este listo, quiere decir que nada parece roto.
  const conAnomalias = cola.filter((c) => c.anomalies.length > 0 || c.voidedCount > 0).length;
  const sinMarcajes = cola.filter((c) => c.eventCount === 0).length;

  // Lo que si dice cuanto falta para cerrar el evento. Sin este numero, un
  // "0 para revisar" se lee como "no queda nada por hacer", que es justo lo
  // contrario de lo que pasa cuando un atleta acaba de terminar.
  const sinVerificar = cola.filter(estaPendienteDeVerificar).length;

  // Cuantos marcajes llegaron por heat: define si una largada se puede deshacer.
  const marcajesDelHeat = (heatId: string) =>
    heats
      .find((h) => h.id === heatId)
      ?.lanes.reduce((n, l) => n + (porCarril.get(l.id)?.eventCount ?? 0), 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Dos por fila en celular: cuatro no entran legibles en 360px. */}
      <section className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <Indicador valor={sinJuez} etiqueta="carriles sin juez" alerta={sinJuez > 0} />
        <Indicador valor={sinMarcajes} etiqueta="sin marcajes" alerta={sinMarcajes > 0} />
        <Indicador valor={conAnomalias} etiqueta="con anomalías" alerta={conAnomalias > 0} />
        <Indicador
          valor={sinVerificar}
          etiqueta="sin verificar"
          alerta={sinVerificar > 0}
          href={`/panel/eventos/${id}/resultados`}
        />
      </section>

      {heats.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          No hay heats armados todavía.
        </p>
      ) : (
        heats.map((heat) => (
          <section key={heat.id} className="rounded-2xl border border-neutral-800 p-4 sm:p-5">
            {/*
              En celular el titulo y la accion van apilados, y el boton ocupa el
              ancho completo. Antes compartian una fila con flex-wrap y el boton
              quedaba flotando al medio, sin alinearse ni a un lado ni al otro.
            */}
            <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="font-semibold">{heat.name}</h2>
                <p className="text-sm text-neutral-500">
                  {/*
                    En el huso del EVENTO, no en el del servidor. Esta pagina se
                    renderiza en Vercel (UTC): un heat largado 20:55 en Bogota
                    salia "1:55" del dia siguiente.
                  */}
                  {heat.started_at
                    ? `Inició ${horaEnEvento(heat.started_at, event.timezone)}`
                    : "Sin iniciar"}
                  {heat.start_source === "device_offline" && (
                    <span className="ml-2 text-amber-400">salida provisional</span>
                  )}
                </p>
              </div>

              {!heat.started_at ? (
                <LargarHeat eventId={id} heat={heat} />
              ) : (
                marcajesDelHeat(heat.id) === 0 && (
                  // Todavia no llego ningun marcaje: se puede deshacer sin
                  // destruir tiempos de nadie.
                  <form action={deshacer.bind(null, id, heat.id)} className="shrink-0">
                    <button
                      type="submit"
                      className="w-full rounded-xl border border-neutral-700 px-4 py-2.5 text-sm text-neutral-400 hover:bg-neutral-900 sm:w-auto"
                    >
                      Deshacer inicio
                    </button>
                  </form>
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
                const info = porCarril.get(lane.id);
                const tieneTiempo = info?.totalMs !== null && info?.totalMs !== undefined;

                return (
                  <li key={lane.id} className="flex items-center gap-3 py-3">
                    <span className="w-6 shrink-0 text-center font-mono text-sm text-neutral-600">
                      {lane.lane_number}
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
                        {lane.judge_id ? (
                          <span className="text-neutral-500">
                            Juez: {porJuez.get(lane.judge_id) ?? "asignado"}
                          </span>
                        ) : (
                          <span className="text-amber-400">sin juez</span>
                        )}
                        {lane.athletes && lane.teamLabel && (
                          <span className="text-neutral-600"> · {lane.teamLabel}</span>
                        )}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm tabular-nums">
                        {tieneTiempo ? (
                          formatElapsed(info.totalMs!)
                        ) : (
                          <EstadoCarril estado={info?.status ?? lane.status} />
                        )}
                      </p>
                      <p className="text-xs text-neutral-600">
                        {info ? `${info.eventCount} marcajes` : "sin datos"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/**
 * Boton de largada.
 *
 * Se deshabilita hasta que TODOS los carriles con atleta tengan juez. La base lo
 * rechaza igual, pero un boton gris que dice por que es mucho mejor que un
 * click que falla en silencio: es la regla de la competencia, no un capricho de
 * la app. Ningun atleta corre sin alguien que le tome los parciales.
 */
function LargarHeat({
  eventId,
  heat,
}: {
  eventId: string;
  heat: { id: string; lanes: Array<{ team_id: string | null; judge_id: string | null }> };
}) {
  const conAtleta = heat.lanes.filter((l) => l.team_id !== null);
  const sinJuez = conAtleta.filter((l) => l.judge_id === null).length;
  const listo = conAtleta.length > 0 && sinJuez === 0;

  return (
    // En celular ocupa el ancho completo y el texto va alineado a la izquierda,
    // como el resto de la tarjeta. Recien en pantalla ancha se va a la derecha.
    <div className="shrink-0 sm:max-w-[17rem] sm:text-right">
      <form action={largar.bind(null, eventId, heat.id)}>
        <button
          type="submit"
          disabled={!listo}
          className="w-full rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:py-2.5"
        >
          INICIAR HEAT
        </button>
      </form>
      {!listo && (
        <p className="mt-2 text-xs text-amber-400">
          {conAtleta.length === 0
            ? "Este heat no tiene atletas en sus carriles."
            : `Faltan ${sinJuez} juez/jueces: cada atleta necesita el suyo antes de iniciar.`}
        </p>
      )}
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
      <p className="mt-1 text-[11px] leading-tight text-neutral-500 sm:text-xs">{etiqueta}</p>
    </Caja>
  );
}

function EstadoCarril({ estado }: { estado: string }) {
  const copy: Record<string, { texto: string; clase: string }> = {
    idle: { texto: "esperando", clase: "text-neutral-600" },
    running: { texto: "en carrera", clase: "text-lime-400" },
    finished: { texto: "terminó", clase: "text-emerald-400" },
    dnf: { texto: "DNF", clase: "text-neutral-500" },
    dq: { texto: "DQ", clase: "text-red-400" },
  };
  const c = copy[estado] ?? { texto: estado, clase: "text-neutral-500" };
  return <span className={`text-xs ${c.clase}`}>{c.texto}</span>;
}

async function largar(eventId: string, heatId: string) {
  "use server";
  await startHeat(eventId, heatId);
}

async function deshacer(eventId: string, heatId: string) {
  "use server";
  await cancelHeatStart(eventId, heatId);
}
