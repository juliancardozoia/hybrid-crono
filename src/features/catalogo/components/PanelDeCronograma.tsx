import type { EventoPublico, HeatPublico } from "../queries";
import { Icono } from "@/shared/components/Icono";
import { horaEnEvento } from "@/shared/utils/fecha";
import { localeDeIntl } from "@/shared/i18n/diccionario";
import type { Idioma } from "@/shared/i18n/idiomas";

/**
 * El cronograma, agrupado por DIA y despues por ARENA.
 *
 * Una lista plana de horas no sirve el dia del evento. Lo que el atleta
 * necesita es "sábado, Pista principal, 9:40, Elite Masculino": dia para
 * ubicarse, arena para saber a donde caminar, hora para saber cuando, categoria
 * para saber si es suyo. Con tres escenarios en paralelo —el caso normal de un
 * CrossFit— una lista sin lugar es directamente inutil.
 *
 * Cuando hay UNA sola arena el agrupamiento por lugar desaparece: repetir
 * "Pista principal" veinte veces es ruido, no informacion.
 *
 * TODAS LAS HORAS SON DEL HUSO DEL EVENTO. Un atleta argentino que mira una
 * competencia en Bogota tiene que ver la hora de Bogota: es la hora a la que
 * tiene que estar ahi. `horaEnEvento` es la unica forma de escribirlas; un
 * `toLocaleTimeString` suelto usa el huso del servidor, que en Vercel es UTC.
 */
export function PanelDeCronograma({
  evento,
  idioma,
}: {
  evento: EventoPublico;
  idioma: Idioma;
}) {
  const dias = agruparPorDia(evento.schedule, evento.timezone, idioma);
  const variasArenas = evento.arenas.length > 1;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Cronograma</h2>
        <p className="text-xs text-neutral-500">
          Horas locales de la competencia ({evento.timezone})
        </p>
      </div>

      {dias.map((dia) => (
        <section key={dia.clave} className="flex flex-col gap-4">
          <h3 className="flex items-center gap-2.5 text-sm font-semibold tracking-wide text-lime-300 uppercase">
            <Icono nombre="calendario" className="h-4 w-4" />
            {dia.titulo}
          </h3>

          {variasArenas ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {agruparPorArena(dia.heats).map((grupo) => (
                <div
                  key={grupo.arena}
                  className="overflow-hidden rounded-2xl border border-neutral-800"
                >
                  <p className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/60 px-4 py-2.5 text-sm font-semibold">
                    <Icono nombre="lugar" className="h-4 w-4 text-neutral-500" />
                    {grupo.arena}
                  </p>
                  <ul className="divide-y divide-neutral-800">
                    {grupo.heats.map((h, i) => (
                      <Fila key={i} heat={h} timezone={evento.timezone} mostrarArena={false} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-neutral-800 overflow-hidden rounded-2xl border border-neutral-800">
              {dia.heats.map((h, i) => (
                <Fila key={i} heat={h} timezone={evento.timezone} mostrarArena={false} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function Fila({
  heat,
  timezone,
  mostrarArena,
}: {
  heat: HeatPublico;
  timezone: string;
  mostrarArena: boolean;
}) {
  const inicio = heat.scheduledAt ? horaEnEvento(heat.scheduledAt, timezone).slice(0, 5) : "—";
  const fin = heat.scheduledEndAt ? horaEnEvento(heat.scheduledEndAt, timezone).slice(0, 5) : null;

  return (
    <li className="flex items-start gap-4 px-4 py-3.5">
      {/* La hora en ancho fijo y tabular: en una columna de veinte filas, los
          dígitos alineados dejan leer el ritmo del día de un vistazo. */}
      <div className="w-14 shrink-0 text-right">
        <p className="font-mono font-semibold tabular-nums text-neutral-100">{inicio}</p>
        {fin && <p className="font-mono text-xs tabular-nums text-neutral-600">{fin}</p>}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium">{heat.workout ?? heat.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-neutral-500">
          {heat.workout && <span>{heat.name}</span>}
          {heat.division && (
            <>
              {heat.workout && <span aria-hidden>·</span>}
              <span className="text-neutral-400">{heat.division}</span>
            </>
          )}
          {mostrarArena && heat.arena && (
            <>
              <span aria-hidden>·</span>
              <span>{heat.arena}</span>
            </>
          )}
          {heat.lanes ? (
            <>
              <span aria-hidden>·</span>
              <span>{heat.lanes} carriles</span>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

interface Dia {
  clave: string;
  titulo: string;
  heats: HeatPublico[];
}

/**
 * Agrupa por dia de calendario EN EL HUSO DEL EVENTO.
 *
 * Agrupar por la fecha UTC del timestamp parte mal el ultimo heat de la noche:
 * un heat a las 20:00 en Bogota es la 1:00 del dia siguiente en UTC y
 * apareceria bajo el domingo cuando corre el sabado.
 */
function agruparPorDia(heats: HeatPublico[], timezone: string, idioma: Idioma): Dia[] {
  const clave = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const titulo = new Intl.DateTimeFormat(localeDeIntl(idioma), {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const porDia = new Map<string, Dia>();

  for (const h of heats) {
    if (!h.scheduledAt) continue;
    const fecha = new Date(h.scheduledAt);
    const k = clave.format(fecha);

    if (!porDia.has(k)) {
      const nombre = titulo.format(fecha);
      porDia.set(k, {
        clave: k,
        titulo: nombre[0].toUpperCase() + nombre.slice(1),
        heats: [],
      });
    }
    porDia.get(k)!.heats.push(h);
  }

  return [...porDia.values()].sort((a, b) => a.clave.localeCompare(b.clave));
}

function agruparPorArena(heats: HeatPublico[]): Array<{ arena: string; heats: HeatPublico[] }> {
  const porArena = new Map<string, HeatPublico[]>();
  for (const h of heats) {
    // Un heat sin arena asignada no se esconde: el organizador todavia no la
    // cargo y el atleta tiene que saber que ese heat existe.
    const nombre = h.arena ?? "Sin escenario asignado";
    if (!porArena.has(nombre)) porArena.set(nombre, []);
    porArena.get(nombre)!.push(h);
  }
  return [...porArena.entries()].map(([arena, heats]) => ({ arena, heats }));
}
