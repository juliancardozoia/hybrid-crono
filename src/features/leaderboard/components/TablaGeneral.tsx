"use client";

import { Fragment, useEffect, useState } from "react";
import { Badge } from "@/shared/components/Badge";
import { Bandera } from "@/shared/components/Bandera";
import { Icono } from "@/shared/components/Icono";
import type { ScoreboardPart } from "@/shared/scoring/scoreboard";
import type { PartPlacement, RoundBreakdownStep } from "@/shared/scoring/types";
import { formatElapsed } from "@/shared/timing/clock";
import { getTablaGeneral, type TablaGeneral as Datos } from "../queries";

/** 🥇🥈🥉 para el podio, y nada para el resto -- no hay medalla de cuarto puesto. */
const MEDALLAS = ["🥇", "🥈", "🥉"];

type EntradaConEquipo = Datos["divisiones"][number]["entries"][number];
type Estado = "activo" | "eliminado";

/**
 * Una fila FUSIONADA de la tabla general: la categoria puede tener varias
 * entradas en `data.divisiones` (una por etapa, cuando hubo un corte), pero
 * en pantalla es SIEMPRE una sola tabla. `entry` es la del equipo en su
 * etapa VIGENTE -- la final si sigue adentro, la ultima que corrio si quedo
 * eliminado en el camino -- y `porEtapa` guarda todas sus entradas para
 * poder buscar el resultado de un WOD de una etapa anterior (un finalista
 * sigue mostrando lo que hizo en el WOD 1 de la clasificatoria).
 */
type FilaTabla = {
  teamId: string;
  entry: EntradaConEquipo;
  estado: Estado;
  etapaVigente: number;
  porEtapa: Map<number, EntradaConEquipo>;
};

/**
 * El resultado CRUDO de una prueba, tal como se cronometro o se cargo --
 * "08:21", "184 reps", "142 kg" -- en vez del puesto. Usa `puesto.value` (sin
 * normalizar, ver `PartPlacement` en shared/scoring/types.ts): el ranking sale
 * siempre de `comparable`, esto es solo para el detalle del atleta.
 */
function formatearResultado(parte: ScoreboardPart, puesto: PartPlacement): string | null {
  if (puesto.status === "dnf") return "DNF";
  if (puesto.status === "dq") return "DQ";

  if (puesto.status === "capeado") {
    if (puesto.capValue === null) return "CAP";
    return `${formatearUnidad(parte.capUnit ?? "reps", puesto.capValue)} · CAP`;
  }

  if (puesto.status !== "valido" || puesto.value === null) return null;

  if (parte.scoreUnit === "rondas_reps") {
    return `${puesto.value} rondas + ${puesto.reps ?? 0} reps`;
  }
  return formatearUnidad(parte.scoreUnit, puesto.value);
}

/**
 * "3 rondas + 10 reps" no dice si esas 10 son de un Push-up (objetivo 10,
 * completo) o de un Air Squat (objetivo 15, a medias) -- reportado como
 * confuso tanto para el juez como para quien mira el leaderboard. Cuando el
 * score trae `roundBreakdown` (ver src/shared/timing/wod.ts), se muestra el
 * detalle movimiento por movimiento en vez del total ambiguo.
 */
function DesgloseDeRonda({ rondaActual, pasos }: { rondaActual: number; pasos: RoundBreakdownStep[] }) {
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
        Ronda {rondaActual}
      </span>
      <div className="flex flex-col gap-0.5">
        {pasos.map((paso, i) => (
          <span
            key={i}
            className={`text-xs ${paso.completo ? "text-lime-400" : "text-amber-300"}`}
          >
            {paso.completo ? "✓" : "●"} {paso.name}
            {!paso.completo && (paso.target > 0 ? ` ${paso.done}/${paso.target}` : ` ${paso.done}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatearUnidad(unidad: string, valor: number): string {
  switch (unidad) {
    case "tiempo":
      return formatElapsed(valor, { centis: false });
    case "reps":
      return `${valor} reps`;
    case "rondas":
      return `${valor} rondas`;
    case "calorias":
      return `${valor} cal`;
    case "distancia":
      return `${valor} m`;
    // El kilaje se guarda siempre en kilos (ver CLAUDE.md, "Kilos o libras");
    // redondeado solo aca, para mostrar -- el motor sigue comparando el
    // numero exacto.
    case "carga":
      return `${Math.round(valor)} kg`;
    default:
      return `${valor} pts`;
  }
}

/**
 * Tabla general por puntos.
 *
 * Se esconde SOLO cuando es redundante con el leaderboard de tiempos
 * (`LeaderboardLive`, que lee `results`): una carrera hibrida con una sola
 * prueba de circuito muestra el mismo ranking en los dos lados. Un WOD de
 * CrossFit no tiene fila en `results` —se puntua por `workout_scores`—, asi
 * que con una sola prueba esta tabla sigue siendo la UNICA que muestra algo;
 * esconderla ahi dejaba el leaderboard completamente vacio aunque el juez ya
 * hubiera cargado el resultado. `soloCircuito` es la senal que distingue los
 * dos casos (ver queries.ts).
 *
 * Refresca por polling, igual que el resto de las pantallas publicas y por la
 * misma razon: el rol anonimo no tiene permisos sobre ninguna tabla y
 * postgres_changes exige SELECT para suscribirse.
 */
const REFRESCO_MS = 8_000;

export function TablaGeneral({ slug, inicial }: { slug: string; inicial: Datos }) {
  const [data, setData] = useState(inicial);
  const [division, setDivision] = useState<string | null>(null);
  // El detalle se despliega EN EL LUGAR, no en un modal -- mismo patron que
  // `GrillaDeAtletas` en /atletas. Un solo id abierto a la vez.
  const [expandido, setExpandido] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelado) return;
      try {
        const fresco = await getTablaGeneral(slug);
        // No se vacia la pantalla si una consulta falla: se sigue mostrando lo
        // ultimo que llego.
        if (!cancelado && fresco.divisiones.length > 0) setData(fresco);
      } catch {
        // Sin red.
      }
      if (!cancelado) timer = setTimeout(poll, REFRESCO_MS);
    };

    timer = setTimeout(poll, REFRESCO_MS);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [slug]);

  if (data.divisiones.length === 0) return null;
  if (data.cantidadDePruebas <= 1 && data.soloCircuito) return null;

  // Una categoria con un corte confirmado tiene una fila en `divisiones` POR
  // ETAPA (Stage 1, Stage 2...), pero para quien mira la pantalla es SIEMPRE
  // una sola categoria y una sola tabla -- separarla en una pestaña por etapa
  // hacia que los eliminados desaparecieran de la vista apenas se confirmaba
  // el corte, en vez de quedar marcados como tales en el mismo lugar.
  const gruposPorDivision = new Map<string, Datos["divisiones"]>();
  for (const d of data.divisiones) {
    const lista = gruposPorDivision.get(d.division.id) ?? [];
    lista.push(d);
    gruposPorDivision.set(d.division.id, lista);
  }
  const divisionesUnicas = [...gruposPorDivision.values()].map((lista) => lista[0].division);

  const divisionElegidaId =
    divisionesUnicas.find((d) => d.id === division)?.id ?? divisionesUnicas[0]?.id ?? "";
  const gruposOrdenados = [...(gruposPorDivision.get(divisionElegidaId) ?? [])].sort(
    (a, b) => a.stage - b.stage,
  );
  const etapaFinal = gruposOrdenados[gruposOrdenados.length - 1];
  const divisionElegida = etapaFinal.division;

  // `etapaFinal.parts` YA es la union acumulada de las partes de todas las
  // etapas hasta la final inclusive (`partesAcumuladas` en scoreboard.ts): el
  // WOD 1 de la clasificatoria no deja de existir cuando arranca la final.
  // Juntar `parts` de cada grupo a mano duplicaria las de las etapas
  // anteriores, que la etapa final ya arrastra.
  const todasLasPartes = etapaFinal.parts;

  // Numera por WORKOUT, no por parte: dos partes del mismo WOD (A/B) comparten
  // numero y se distinguen por su `label`, en vez de contar "WOD 3" y "WOD 4"
  // para lo que en la pizarra es un solo WOD.
  const numeroDeWorkout = new Map<string, number>();
  for (const p of todasLasPartes) {
    if (!numeroDeWorkout.has(p.workoutId)) numeroDeWorkout.set(p.workoutId, numeroDeWorkout.size + 1);
  }

  // Quien sigue compitiendo: los que tienen entrada en la etapa mas reciente.
  const idsActivos = new Set(etapaFinal.entries.map((e) => e.teamId));

  // La entrada de cada equipo en cada etapa en la que participo, para poder
  // buscar el resultado de un WOD de una etapa anterior sin recalcular nada.
  const entradasPorEquipo = new Map<string, Map<number, EntradaConEquipo>>();
  for (const grupo of gruposOrdenados) {
    for (const entry of grupo.entries) {
      const porEtapa = entradasPorEquipo.get(entry.teamId) ?? new Map<number, EntradaConEquipo>();
      porEtapa.set(grupo.stage, entry);
      entradasPorEquipo.set(entry.teamId, porEtapa);
    }
  }

  const filas: FilaTabla[] = [...entradasPorEquipo.entries()].map(([teamId, porEtapa]) => {
    const etapaVigente = Math.max(...porEtapa.keys());
    return {
      teamId,
      // El `!` es seguro: etapaVigente sale de las claves del mismo mapa.
      entry: porEtapa.get(etapaVigente)!,
      estado: idsActivos.has(teamId) ? "activo" : ("eliminado" as Estado),
      etapaVigente,
      porEtapa,
    };
  });

  // Activos primero (por su posicion vigente); los eliminados despues,
  // agrupados por en que etapa quedaron afuera -- el que llego mas lejos
  // antes de caer se ve primero dentro de ese grupo.
  filas.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === "activo" ? -1 : 1;
    if (a.etapaVigente !== b.etapaVigente) return b.etapaVigente - a.etapaVigente;
    return a.entry.position - b.entry.position;
  });

  return (
    <section className="mt-10">
      {/* Sin titulo propio: la pantalla que la incrusta (panel o publica) ya
          puso "Leaderboard" arriba -- un segundo titulo "Tabla general" era el
          mismo concepto repetido dos veces en la misma pantalla. */}
      <div className="flex flex-wrap items-baseline justify-end gap-3">
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            data.official
              ? "bg-lime-400/15 text-lime-300"
              : "bg-amber-400/15 text-amber-300"
          }`}
        >
          {data.official ? "OFICIAL" : "NO OFICIAL"}
        </span>
      </div>

      {/* Un solo boton de pestana por CATEGORIA, nunca por etapa: el filtro
          tiene que aparecer apenas hay mas de una categoria, sin importar
          cuantas etapas tenga cada una. */}
      {divisionesUnicas.length > 1 && (
        <nav className="tabs-scroll mt-4 flex gap-1 border-b border-neutral-800">
          {divisionesUnicas.map((d) => {
            const activa = d.id === divisionElegida.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDivision(d.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  activa
                    ? "border-lime-400 font-medium text-neutral-100"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {d.name}
              </button>
            );
          })}
        </nav>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <th className="w-10 py-2 pr-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Atleta</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              {todasLasPartes.map((p) => (
                <th
                  key={p.id}
                  title={`${p.workoutName}${p.label ? ` ${p.label}` : ""}`}
                  className="py-2 pr-3 text-right font-medium whitespace-nowrap"
                >
                  {`WOD ${numeroDeWorkout.get(p.workoutId)}`}
                  {p.label && ` ${p.label}`}
                </th>
              ))}
              <th className="py-2 pr-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, i) => {
              const abierto = expandido === fila.teamId;
              const eliminado = fila.estado === "eliminado";
              const equipo = fila.entry.team;
              return (
                <Fragment key={fila.teamId}>
                  <tr
                    className={`border-b border-neutral-900 ${
                      // Un eliminado se distingue con su propio color, por
                      // encima del rayado tenue que ya usan las filas impares
                      // -- no se puede confundir con un simple cambio de
                      // rayado, tiene que leerse como "esto ya no compite".
                      eliminado
                        ? "bg-red-500/[0.05]"
                        : i % 2 === 1
                          ? "bg-amber-500/[0.035]"
                          : ""
                    }`}
                  >
                    <td
                      className={`w-10 py-2 pr-3 font-mono tabular-nums ${
                        eliminado ? "text-neutral-600" : "text-neutral-400"
                      }`}
                    >
                      {fila.entry.position}
                      {/* Compartir posicion no es un error: el reglamento no rompe
                          los empates de la tabla general si los puestos por prueba
                          tambien empatan. Antes era un "=" gris casi invisible;
                          ahora es un color de apoyo (ambar) mas un titulo, para
                          que el organizador o el locutor sepan que no es un
                          error de la pantalla. */}
                      {fila.entry.tiedWith > 1 && (
                        <span
                          className="ml-0.5 font-semibold text-amber-400"
                          title={`Empatado con ${fila.entry.tiedWith - 1} equipo${fila.entry.tiedWith - 1 === 1 ? "" : "s"} mas`}
                        >
                          =
                        </span>
                      )}
                    </td>
                    <td className={`py-2 pr-3 ${eliminado ? "text-neutral-500" : ""}`}>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandido((actual) => (actual === fila.teamId ? null : fila.teamId))
                        }
                        className="flex w-full items-center gap-2 text-left"
                        aria-expanded={abierto}
                        title={abierto ? "Ocultar detalle" : "Ver detalle del atleta"}
                      >
                        <Icono
                          nombre="flecha"
                          className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${
                            abierto ? "rotate-90" : ""
                          }`}
                        />
                        {/* Una bandera por integrante, en el mismo orden que
                            `athletes` -- un equipo mixto no puede mentir con
                            una sola bandera para los dos. Si no hay pais
                            cargado, no se rompe: Bandera no pinta nada. */}
                        <span className="flex shrink-0 items-center gap-1">
                          {equipo.countries.map((pais, idx) => (
                            <Bandera key={idx} codigo={pais} className="h-3 w-4 shrink-0" />
                          ))}
                        </span>
                        <span className="truncate">{equipo.name ?? equipo.athletes ?? ""}</span>
                      </button>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                          eliminado
                            ? "bg-red-500/15 text-red-300"
                            : "bg-lime-400/15 text-lime-300"
                        }`}
                      >
                        {eliminado ? "Eliminado" : "Activo"}
                      </span>
                    </td>
                    {todasLasPartes.map((p) => {
                      // El resultado de un WOD sale de la entrada de la etapa
                      // A LA QUE PERTENECE ESE WOD, no de la etapa vigente del
                      // equipo: un finalista sigue mostrando lo que hizo en el
                      // WOD 1 de la clasificatoria, aunque su entrada vigente
                      // ya sea la de la final.
                      const entryDeEsaEtapa = fila.porEtapa.get(p.stage);
                      const puesto = entryDeEsaEtapa?.placements.find((x) => x.partId === p.id);
                      // "pendiente" es un equipo del padron que todavia no corrio
                      // esta prueba (ver rankPart en place.ts): mostrarle una
                      // posicion -- aunque sea la 1, empatado con todos los demas
                      // que tampoco corrieron- se lee como que ya esta ganando
                      // algo que ni empezo.
                      const sinCorrer = !puesto || puesto.status === "pendiente";
                      return (
                        <td
                          key={p.id}
                          className="py-2 pr-3 text-right font-mono tabular-nums text-neutral-400"
                        >
                          {/* Puntos redondeados SOLO para mostrar, igual que
                              `displayPoints`: `puesto.points` sigue intacto en el
                              motor. */}
                          {sinCorrer ? "—" : `${puesto.position}º/${Math.round(puesto.points)}`}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-3 text-right font-mono tabular-nums font-semibold">
                      {/* Redondeado SOLO para mostrar: `totalPoints` (3 decimales)
                          sigue siendo lo que ordena y desempata. Para un
                          eliminado es el total de la etapa en la que quedo
                          afuera -- su ultimo resultado oficial. */}
                      {fila.entry.displayPoints}
                    </td>
                  </tr>

                  {/* El detalle se despliega EN EL LUGAR, no en un modal --
                      mismo patron que GrillaDeAtletas en /atletas. */}
                  {abierto && (
                    <tr className="border-b border-neutral-900">
                      <td colSpan={4 + todasLasPartes.length} className="bg-neutral-900/40 p-4">
                        <DetalleDelAtleta
                          fila={fila}
                          parts={todasLasPartes}
                          fieldSize={
                            gruposOrdenados.find((g) => g.stage === fila.etapaVigente)?.entries
                              .length ?? filas.length
                          }
                          division={divisionElegida}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * El detalle de UN atleta/equipo: la misma informacion que ya calculo
 * `buildScoreboard`, solo reorganizada para leer de un vistazo -- nada se
 * recalcula aca.
 */
function DetalleDelAtleta({
  fila,
  parts,
  fieldSize,
  division,
}: {
  fila: FilaTabla;
  parts: ScoreboardPart[];
  fieldSize: number;
  division: Datos["divisiones"][number]["division"];
}) {
  const eliminado = fila.estado === "eliminado";
  const equipo = fila.entry.team;
  // Sin medalla para un eliminado: la posicion que quedo congelada es la de
  // la etapa en la que salio, no un podio de la competencia completa.
  const medalla = !eliminado ? (MEDALLAS[fila.entry.position - 1] ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-base font-semibold text-neutral-100">
            {equipo.name ?? equipo.athletes ?? ""}
          </p>
          <p className="text-sm text-neutral-500">
            #{equipo.bib} · {division.name}
            {equipo.box && ` · ${equipo.box}`}
          </p>
          {eliminado && (
            <p className="mt-1 text-xs font-semibold text-red-400">
              Eliminado en la Etapa {fila.etapaVigente}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <EstadisticaResumen
            etiqueta={eliminado ? `Etapa ${fila.etapaVigente}` : "Overall"}
            valor={`${medalla ?? ""} ${fila.entry.position} / ${fieldSize}`}
          />
          <EstadisticaResumen
            etiqueta="Total"
            valor={`${fila.entry.displayPoints} pts`}
            destacado={!eliminado}
          />
          {/* El empate deportivo se COMPARTE: misma posicion, misma medalla si
              corresponde. Que los puntos sean iguales o no depende de la
              politica de la categoria (same_position_points reparte integro,
              average_occupied_positions promedia las posiciones ocupadas) --
              este aviso es solo sobre la POSICION, no asume nada de los
              puntos. */}
          {fila.entry.tiedWith > 1 && (
            <Badge tono="warning">
              Empate ({fila.entry.tiedWith} equipos en el puesto {fila.entry.position})
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {parts.map((p) => {
          // El resultado de un WOD sale de la entrada de la etapa a la que
          // pertenece ESE wod, no de la etapa vigente del equipo -- mismo
          // criterio que la tabla principal.
          const entryDeEsaEtapa = fila.porEtapa.get(p.stage);
          const puesto = entryDeEsaEtapa?.placements.find((x) => x.partId === p.id);
          const pendiente = !puesto || puesto.status === "pendiente";
          const enCurso = puesto?.status === "en_curso";
          const terminado = !pendiente && !enCurso;
          const resultado = puesto ? formatearResultado(p, puesto) : null;

          // Wods que YA PASARON (terminado o corriendo ahora) se distinguen
          // visualmente de los que siguen (pendiente): borde y fondo propios
          // en vez del mismo gris neutro para los tres estados -- es lo que
          // pide "resaltar los wods que ya pasaron y los que siguen".
          const estiloCaja = terminado
            ? "border-lime-500/30 bg-lime-500/[0.04]"
            : enCurso
              ? "border-amber-500/40 bg-amber-500/[0.06]"
              : "border-neutral-800/60 bg-neutral-950/20 opacity-70";

          return (
            <div
              key={p.id}
              className={`flex flex-col gap-2 rounded-xl border p-4 ${estiloCaja}`}
            >
              <div className="flex items-start justify-between gap-2">
                {/* En la TARJETA va el nombre real del WOD (el que se
                    configuro en /pruebas) -- la tabla principal de arriba
                    conserva "WOD 1", "WOD 2"... a proposito, ver
                    numeroDeWorkout en el thead. */}
                <p
                  className="truncate text-xs font-medium text-neutral-400"
                  title={`${p.workoutName}${p.label ? ` ${p.label}` : ""}`}
                >
                  {p.workoutName}
                  {p.label && ` ${p.label}`}
                </p>
                {terminado && (
                  <Icono nombre="tilde" className="h-3.5 w-3.5 shrink-0 text-lime-400" />
                )}
                {enCurso && (
                  <span className="shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300 uppercase">
                    En curso
                  </span>
                )}
              </div>

              {/* Cuerpo con `flex-1`: absorbe el espacio sobrante para que
                  "N pts" quede siempre pegado abajo, sea cual sea el largo
                  del contenido de arriba (una tarjeta con desglose de ronda
                  no puede dejar un hueco enorme en la de al lado que solo
                  muestra tiempo). */}
              <div className="flex-1">
                {pendiente ? (
                  <p className="text-sm text-neutral-600">Aun no corre</p>
                ) : enCurso ? (
                  <p className="text-sm text-amber-300">Corriendo ahora</p>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-neutral-100">
                      {puesto.position}
                      <span className="text-sm text-neutral-500">º</span>
                    </p>
                    {puesto.roundBreakdown && puesto.roundBreakdown.length > 0 ? (
                      <DesgloseDeRonda
                        rondaActual={(puesto.value ?? 0) + 1}
                        pasos={puesto.roundBreakdown}
                      />
                    ) : (
                      resultado && <p className="text-sm text-neutral-400">{resultado}</p>
                    )}
                  </>
                )}
              </div>

              {terminado && (
                <p className="font-mono text-sm font-semibold text-lime-400">
                  {Math.round(puesto.points)} pts
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EstadisticaResumen({
  etiqueta,
  valor,
  destacado = false,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 px-4 py-2 text-center">
      <p className="text-[0.65rem] font-medium tracking-wide text-neutral-500 uppercase">
        {etiqueta}
      </p>
      <p className={`font-mono text-lg font-bold ${destacado ? "text-lime-400" : "text-neutral-100"}`}>
        {valor}
      </p>
    </div>
  );
}
