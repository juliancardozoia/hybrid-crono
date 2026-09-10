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

  // La clave combina division + etapa: una categoria con un corte confirmado
  // tiene dos filas en `divisiones` (Stage 1 y Stage 2), con el mismo nombre.
  const clave = (d: Datos["divisiones"][number]) => `${d.division.id}|${d.stage}`;
  const elegida = data.divisiones.find((d) => clave(d) === division) ?? data.divisiones[0];

  // Numera por WORKOUT, no por parte: dos partes del mismo WOD (A/B) comparten
  // numero y se distinguen por su `label`, en vez de contar "WOD 3" y "WOD 4"
  // para lo que en la pizarra es un solo WOD.
  const numeroDeWorkout = new Map<string, number>();
  for (const p of elegida.parts) {
    if (!numeroDeWorkout.has(p.workoutId)) numeroDeWorkout.set(p.workoutId, numeroDeWorkout.size + 1);
  }

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

      {data.divisiones.length > 1 && (
        <nav className="tabs-scroll mt-4 flex gap-1 border-b border-neutral-800">
          {data.divisiones.map((d) => {
            const activa = clave(d) === clave(elegida);
            return (
              <button
                key={clave(d)}
                type="button"
                onClick={() => setDivision(clave(d))}
                className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  activa
                    ? "border-lime-400 font-medium text-neutral-100"
                    : "border-transparent text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {d.division.name}
                {/* Solo se aclara la etapa si esta categoria tiene mas de una:
                    la mayoria de las competencias no tienen cortes y repetirlo
                    ahi seria ruido. */}
                {data.divisiones.filter((x) => x.division.id === d.division.id).length > 1 &&
                  ` · Etapa ${d.stage}`}
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
              {elegida.parts.map((p) => (
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
            {elegida.entries.map((fila, i) => {
              const abierto = expandido === fila.teamId;
              return (
                <Fragment key={fila.teamId}>
                  <tr
                    className={`border-b border-neutral-900 ${
                      // Rayado calido y tenue para distinguir filas: solo en
                      // las impares, y por debajo de cualquier otro color
                      // (empate, seleccion) que ya use la fila.
                      i % 2 === 1 ? "bg-amber-500/[0.035]" : ""
                    }`}
                  >
                    <td className="w-10 py-2 pr-3 font-mono tabular-nums text-neutral-400">
                      {fila.position}
                      {/* Compartir posicion no es un error: el reglamento no rompe
                          los empates de la tabla general si los puestos por prueba
                          tambien empatan. Antes era un "=" gris casi invisible;
                          ahora es un color de apoyo (ambar) mas un titulo, para
                          que el organizador o el locutor sepan que no es un
                          error de la pantalla. */}
                      {fila.tiedWith > 1 && (
                        <span
                          className="ml-0.5 font-semibold text-amber-400"
                          title={`Empatado con ${fila.tiedWith - 1} equipo${fila.tiedWith - 1 === 1 ? "" : "s"} mas`}
                        >
                          =
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
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
                          {fila.team.countries.map((pais, idx) => (
                            <Bandera key={idx} codigo={pais} className="h-3 w-4 shrink-0" />
                          ))}
                        </span>
                        <span className="truncate">
                          {fila.team.name ?? fila.team.athletes ?? ""}
                        </span>
                      </button>
                    </td>
                    {elegida.parts.map((p) => {
                      const puesto = fila.placements.find((x) => x.partId === p.id);
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
                          sigue siendo lo que ordena y desempata. */}
                      {fila.displayPoints}
                    </td>
                  </tr>

                  {/* El detalle se despliega EN EL LUGAR, no en un modal --
                      mismo patron que GrillaDeAtletas en /atletas. */}
                  {abierto && (
                    <tr className="border-b border-neutral-900">
                      <td colSpan={3 + elegida.parts.length} className="bg-neutral-900/40 p-4">
                        <DetalleDelAtleta
                          fila={fila}
                          parts={elegida.parts}
                          numeroDeWorkout={numeroDeWorkout}
                          fieldSize={elegida.entries.length}
                          division={elegida.division}
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
  numeroDeWorkout,
  fieldSize,
  division,
}: {
  fila: Datos["divisiones"][number]["entries"][number];
  parts: ScoreboardPart[];
  numeroDeWorkout: Map<string, number>;
  fieldSize: number;
  division: Datos["divisiones"][number]["division"];
}) {
  const medalla = MEDALLAS[fila.position - 1] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-base font-semibold text-neutral-100">
            {fila.team.name ?? fila.team.athletes ?? ""}
          </p>
          <p className="text-sm text-neutral-500">
            #{fila.team.bib} · {division.name}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <EstadisticaResumen
            etiqueta="Overall"
            valor={`${medalla ?? ""} ${fila.position} / ${fieldSize}`}
          />
          <EstadisticaResumen etiqueta="Total" valor={`${fila.displayPoints} pts`} destacado />
          {/* El empate deportivo se COMPARTE: misma posicion, misma medalla si
              corresponde. Que los puntos sean iguales o no depende de la
              politica de la categoria (same_position_points reparte integro,
              average_occupied_positions promedia las posiciones ocupadas) --
              este aviso es solo sobre la POSICION, no asume nada de los
              puntos. */}
          {fila.tiedWith > 1 && (
            <Badge tono="warning">
              Empate ({fila.tiedWith} equipos en el puesto {fila.position})
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {parts.map((p) => {
          const puesto = fila.placements.find((x) => x.partId === p.id);
          const sinCorrer = !puesto || puesto.status === "pendiente" || puesto.status === "en_curso";
          const resultado = puesto ? formatearResultado(p, puesto) : null;

          return (
            <div
              key={p.id}
              className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-3"
            >
              <p
                className="truncate text-xs font-medium text-neutral-500"
                title={`${p.workoutName}${p.label ? ` ${p.label}` : ""}`}
              >
                {`WOD ${numeroDeWorkout.get(p.workoutId)}`}
                {p.label && ` ${p.label}`}
              </p>
              {sinCorrer ? (
                <p className="mt-1.5 text-sm text-neutral-600">Sin resultado aun</p>
              ) : (
                <>
                  <p className="mt-1.5 text-sm font-semibold text-neutral-200">
                    {puesto.position}º
                  </p>
                  {puesto.roundBreakdown && puesto.roundBreakdown.length > 0 ? (
                    <DesgloseDeRonda rondaActual={(puesto.value ?? 0) + 1} pasos={puesto.roundBreakdown} />
                  ) : (
                    resultado && <p className="text-xs text-neutral-400">{resultado}</p>
                  )}
                  <p className="mt-1 font-mono text-xs font-semibold text-lime-400">
                    {Math.round(puesto.points)} pts
                  </p>
                </>
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
