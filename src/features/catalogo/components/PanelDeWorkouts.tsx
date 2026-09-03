import type { BloquePublico, EventoPublico, MovimientoPublico } from "../queries";
import { Icono } from "@/shared/components/Icono";

/**
 * Las pruebas, explicadas como las lee un atleta.
 *
 * NO SE MUESTRA EL ESQUEMA INTERNO, SE MUESTRA EL WOD. La version anterior
 * decia "ventana · rondas_reps · 720000ms", que son los campos de la base. Un
 * atleta lee "AMRAP 12 min" y debajo la lista de movimientos con sus reps y sus
 * kilos, que es como esta escrito en la pizarra del box.
 *
 * LOS PESOS POR CATEGORIA SON EL DATO. Rx y Scaled no levantan lo mismo, y el
 * peso es lo que decide en que categoria se anota alguien. Estaba en la base
 * (`division_movement_specs`) y no salia por ningun lado: habia que esperar a
 * que el organizador lo publicara por Instagram.
 *
 * Una prueba sin liberar se LISTA pero no se abre. El organizador carga los WODs
 * con semanas de anticipacion para configurar la pantalla del juez, y cuando se
 * revelan lo decide el.
 */

const UNIDAD: Record<string, string> = {
  reps: "reps",
  metros: "m",
  calorias: "cal",
  segundos: "s",
  kg: "kg",
};

const BLOQUE: Record<string, string> = {
  buy_in: "Buy-in",
  trabajo: "",
  descanso: "Descanso",
  cash_out: "Cash-out",
};

const EQUIPO: Record<string, string> = {
  individual: "",
  sincronizado: "Sincronizado",
  alternado: "Alternado",
  relevo: "Relevo",
  reparto_libre: "Reparto libre",
};

export function PanelDeWorkouts({ evento }: { evento: EventoPublico }) {
  const esCircuito = evento.format === "carrera_hibrida";

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">{esCircuito ? "El circuito" : "Las pruebas"}</h2>

      <div className="flex flex-col gap-5">
        {evento.workouts.map((w, i) => (
          <article
            key={w.name}
            className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/30"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-800 font-mono text-sm font-bold text-neutral-400">
                  {i + 1}
                </span>
                <h3 className="text-lg font-semibold">{w.name}</h3>
              </div>

              {!w.liberado && (
                <span className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-500">
                  Se anuncia más adelante
                </span>
              )}
            </div>

            {w.liberado && (
              <div className="flex flex-col gap-6 p-5">
                {w.description && (
                  <p className="whitespace-pre-line text-neutral-300">{w.description}</p>
                )}

                {w.parts.map((p, j) => (
                  <Parte key={j} parte={p} unica={w.parts.length === 1} />
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function Parte({
  parte,
  unica,
}: {
  parte: EventoPublico["workouts"][number]["parts"][number];
  unica: boolean;
}) {
  const equipo = EQUIPO[parte.teamMode] ?? "";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {!unica && parte.label && (
          <span className="rounded-md bg-lime-400/15 px-2 py-0.5 font-mono text-sm font-bold text-lime-300">
            {parte.label}
          </span>
        )}
        <span className="font-semibold">{titulo(parte)}</span>
        {equipo && (
          <span className="rounded-full border border-neutral-700 px-2.5 py-0.5 text-xs text-neutral-400">
            {equipo}
          </span>
        )}
      </div>

      {parte.divisiones.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
          <Icono nombre="personas" className="h-3.5 w-3.5" />
          {parte.divisiones.join(" · ")}
        </p>
      )}

      {parte.blocks.length === 0 ? (
        // Un circuito no tiene bloques: su estructura son los segmentos, que
        // viven en otra tabla y no se publican como movimientos.
        <p className="text-sm text-neutral-500">
          Circuito cronometrado. El detalle de las estaciones lo publica la organización.
        </p>
      ) : (
        parte.blocks.map((b, i) => <Bloque key={i} bloque={b} />)
      )}
    </section>
  );
}

/** "AMRAP 12 min", "For Time · cap 10 min", "EMOM cada 60 s". */
function titulo(parte: EventoPublico["workouts"][number]["parts"][number]): string {
  const min = (ms: number) => Math.round(ms / 60000);

  switch (parte.timeScheme) {
    case "ventana":
      return parte.windowMs ? `AMRAP ${min(parte.windowMs)} min` : "AMRAP";
    case "cap":
      return parte.timeCapMs ? `For Time · cap ${min(parte.timeCapMs)} min` : "For Time con cap";
    case "libre":
      return "For Time";
    case "intervalos":
      return parte.intervalMs
        ? `Intervalos cada ${Math.round(parte.intervalMs / 1000)} s`
        : "Intervalos";
    case "sin_reloj":
      return "Carga máxima";
    case "circuito":
      return "Circuito cronometrado";
    default:
      return parte.timeScheme;
  }
}

function Bloque({ bloque }: { bloque: BloquePublico }) {
  const etiqueta = BLOQUE[bloque.kind] ?? "";

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
      {(etiqueta || bloque.label || bloque.rondas > 1) && (
        <p className="mb-2.5 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
          {[
            bloque.rondas > 1 ? `${bloque.rondas} rondas` : "",
            etiqueta,
            bloque.label,
            bloque.duracionMs ? `${Math.round(bloque.duracionMs / 1000)} s de trabajo` : "",
            bloque.descansoMs ? `${Math.round(bloque.descansoMs / 1000)} s de descanso` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <ul className="flex flex-col gap-2.5">
        {bloque.movimientos.map((m, i) => (
          <Movimiento key={i} mov={m} rondas={bloque.rondas} />
        ))}
      </ul>
    </div>
  );
}

function Movimiento({ mov, rondas }: { mov: MovimientoPublico; rondas: number }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono font-semibold tabular-nums text-lime-300">
          {objetivo(mov, rondas)}
        </span>
        <span className="font-medium">{mov.nombre ?? "Movimiento"}</span>
        {mov.cargaKg !== null && (
          <span className="flex items-center gap-1 text-sm text-neutral-400">
            <Icono nombre="pesa" className="h-3.5 w-3.5" />
            {Number(mov.cargaKg)} kg
          </span>
        )}
      </div>

      {mov.notas && <p className="text-sm text-neutral-500">{mov.notas}</p>}

      {/* El peso de cada categoria. Es el dato por el que se entra a esta
          pantalla, asi que va debajo del movimiento y no en una tabla aparte:
          se lee junto a lo que modifica. */}
      {mov.porCategoria.length > 0 && (
        <ul className="mt-0.5 flex flex-wrap gap-1.5">
          {mov.porCategoria.map((c) => (
            <li
              key={c.division}
              className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs"
            >
              <span className="text-neutral-400">{c.division}</span>
              <span className="ml-1.5 font-medium text-neutral-100">
                {[
                  c.objetivo?.length ? c.objetivo.join("-") : null,
                  c.cargaKg !== null ? `${Number(c.cargaKg)} kg` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * "21-15-9", "10", "máx" — el objetivo tal como se escribe en la pizarra.
 *
 * `target_per_round` es un arreglo con un valor por ronda. Cuando trae uno solo
 * el objetivo es el mismo todas las rondas y repetirlo tres veces ("10-10-10")
 * seria ruido; cuando trae varios, ES el esquema, y "21-15-9" le dice a un
 * atleta de CrossFit mas que cualquier explicacion.
 */
function objetivo(mov: MovimientoPublico, rondas: number): string {
  if (mov.maxReps) return "máx";

  const valores = mov.objetivo ?? [];
  if (valores.length === 0) return "—";

  const unidad = UNIDAD[mov.unidad] ?? mov.unidad;
  const numeros =
    valores.length === 1 || rondas === 1 ? String(valores[0]) : valores.join("-");

  return unidad === "reps" ? numeros : `${numeros} ${unidad}`;
}
