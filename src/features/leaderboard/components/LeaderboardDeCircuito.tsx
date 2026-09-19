"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bandera } from "@/shared/components/Bandera";
import { Icono } from "@/shared/components/Icono";
import { Selector } from "@/shared/components/Selector";
import { formatElapsed } from "@/shared/timing/clock";
import type { CircuitosDelEvento, Leaderboard, LeaderboardRow } from "../queries";
import { duracionesDeReferencia, progresoDeCircuito } from "../lib/circuito";
import { EstadoOficial } from "./LeaderboardLive";
import { LineaDeTiempoDeCircuito } from "./LineaDeTiempoDeCircuito";

/**
 * El leaderboard de una carrera hibrida COMO LO MIRA LA ORGANIZACION.
 *
 * QUE LE AGREGA AL LEADERBOARD PUBLICO (`LeaderboardLive`). Aquel contesta
 * "¿quien va ganando?" y es lo que ve el atleta: posicion y tiempo. Esta
 * contesta "¿donde esta cada uno AHORA?", que es la pregunta del dia del
 * evento y la que no tenia respuesta en ninguna pantalla: el organizador veia
 * "en carrera" y nada mas, sin forma de saber si ese atleta iba por la segunda
 * estacion o por la ultima. Por eso son dos componentes y no una bandera
 * dentro de uno: el publico no necesita —ni le corresponde— seguir la
 * produccion del evento estacion por estacion.
 *
 * NO REIMPLEMENTA EL RANKING. La posicion, el estado y los parciales salen de
 * `getLeaderboard`, la misma consulta que alimenta la vista publica y el
 * proyector. Lo unico que suma es la ESTRUCTURA del circuito
 * (`getCircuitosDelEvento`), que es lo que permite derivar en que estacion va
 * cada uno. Si el podio de esta pantalla pudiera diferir del que ve el atleta,
 * el producto entero pierde sentido.
 *
 * LAS FILAS ESTAN COLAPSADAS. Un circuito son 16 parciales por atleta: con
 * veinte atletas desplegados de entrada, la pantalla son dos mil pixeles de
 * scroll y encontrar a alguien es imposible. Colapsadas, la lista entra
 * completa y el detalle se abre donde hace falta —el mismo patron que ya usan
 * la tabla general y la grilla de atletas—.
 *
 * ES AUTOCONTENIDO A PROPOSITO: recibe todo por props y no consulta nada por su
 * cuenta, asi que cualquier otra pantalla que consiga estos dos datos puede
 * montarlo tal cual.
 */
const REFRESCO_MS = 10_000;

export function LeaderboardDeCircuito({
  leaderboard,
  circuitos,
  categoria,
}: {
  leaderboard: Leaderboard;
  circuitos: CircuitosDelEvento;
  /**
   * Categoria CONTROLADA desde afuera, por nombre — mismo criterio que
   * `LeaderboardLive` y `TablaGeneral`. Sin ella, el componente dibuja su
   * propio selector.
   */
  categoria?: string;
}) {
  const router = useRouter();
  const controlado = categoria !== undefined;
  const [division, setDivision] = useState<string | null>(null);
  // UN solo detalle abierto a la vez, como la tabla general de CrossFit: abrir
  // otro cierra el anterior. Con veinte atletas, tener varios mapas abiertos
  // es justo el scroll que esta pantalla evita.
  const [abierto, setAbierto] = useState<number | null>(null);

  const enCarrera = leaderboard.rows.some((r) => r.status === "running");

  // Se refresca desde el SERVIDOR y no puliendo una consulta publica: lo que
  // cambia en vivo no es solo el leaderboard, tambien la largada del heat de
  // los que todavia no arrancaron. Es el mismo mecanismo que usa la torre de
  // control, y por el mismo motivo: nada mientras no haya nada que mirar.
  useEffect(() => {
    if (!enCarrera) return;
    const timer = setInterval(() => router.refresh(), REFRESCO_MS);
    return () => clearInterval(timer);
  }, [enCarrera, router]);

  const divisionActiva = controlado
    ? (categoria ?? null)
    : (division ?? leaderboard.divisions[0] ?? null);

  const filas = useMemo(
    () => leaderboard.rows.filter((r) => r.divisionName === divisionActiva),
    [leaderboard.rows, divisionActiva],
  );

  const segmentos = divisionActiva ? (circuitos.porCategoria[divisionActiva] ?? []) : [];

  // La referencia se calcula con los de SU MISMA categoria: Elite y Amateur
  // pueden correr el mismo circuito con distancias distintas, asi que mezclarlos
  // daria una escala que no es de ninguno de los dos.
  const referencias = useMemo(() => duracionesDeReferencia(filas), [filas]);

  if (leaderboard.rows.length === 0) return null;

  const alternar = (bib: number) => setAbierto((actual) => (actual === bib ? null : bib));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!controlado && leaderboard.divisions.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Categoría</span>
            <Selector
              value={divisionActiva ?? ""}
              onChange={(e) => {
                setDivision(e.target.value);
                // Lo desplegado era de la categoria anterior: las posiciones
                // no significan lo mismo en la nueva.
                setAbierto(null);
              }}
              className="min-w-0 flex-1 py-2 text-sm sm:flex-none"
            >
              {leaderboard.divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Selector>
          </label>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-3">
          <EstadoOficial official={leaderboard.official} />
        </div>
      </div>

      {segmentos.length === 0 && (
        // Sin circuito asignado no hay estaciones contra las cuales ubicar los
        // parciales. Se dice, en vez de mostrar la tabla sin la columna y dejar
        // al organizador preguntandose por que a esta categoria le falta.
        <p className="rounded-xl border border-dashed border-neutral-800 px-4 py-3 text-sm text-neutral-500">
          Esta categoría todavía no tiene un circuito asignado, así que no se puede saber en qué
          estación va cada atleta. Se configura en Configuración competencia → Categorías.
        </p>
      )}

      {/* Mismo aspecto de tabla que la general de CrossFit (`TablaGeneral`):
          encabezados, filas rayadas y el detalle desplegado EN EL LUGAR. Al
          abrir una fila, ella y su detalle comparten fondo y una barra lateral
          lima, para que se lea como UN bloque y no como dos cosas apiladas. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <th className="w-14 py-2 pr-3 pl-3 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Atleta / Equipo</th>
              <th className="py-2 pr-3 font-medium">Estación actual</th>
              <th className="py-2 pr-3 font-medium">Estado</th>
              <th className="py-2 pr-3 text-right font-medium">Tiempo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((row, i) => {
              const desplegado = abierto === row.bib;
              const progreso = progresoDeCircuito(row, segmentos);
              const largada = circuitos.largadaPorDorsal[row.bib] ?? null;
              const box = circuitos.boxPorDorsal[row.bib] ?? null;
              const puedeAbrir = segmentos.length > 0;
              const fondo = desplegado
                ? "bg-neutral-900/40"
                : i % 2 === 1
                  ? "bg-amber-500/[0.035]"
                  : "";
              const barra = `border-l-2 ${desplegado ? "border-lime-400" : "border-transparent"}`;

              return (
                <Fragment key={`${row.divisionName}-${row.bib}`}>
                  <tr
                    onClick={puedeAbrir ? () => alternar(row.bib) : undefined}
                    className={`border-b border-neutral-900 ${fondo} ${
                      puedeAbrir ? "cursor-pointer hover:bg-neutral-900/60" : ""
                    }`}
                  >
                    <td className={`py-3 pr-3 pl-3 ${barra}`}>
                      <Posicion row={row} />
                    </td>
                    <td className="py-3 pr-3">
                      <button
                        type="button"
                        aria-expanded={desplegado}
                        disabled={!puedeAbrir}
                        title={desplegado ? "Ocultar parciales" : "Ver parciales"}
                        className="flex w-full items-center gap-2 text-left"
                      >
                        <Icono
                          nombre="flecha"
                          className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${
                            desplegado ? "rotate-90" : ""
                          } ${puedeAbrir ? "" : "opacity-0"}`}
                        />
                        {row.countries.length > 0 && (
                          <span className="flex shrink-0 items-center gap-1">
                            {row.countries.map((pais, idx) => (
                              <Bandera key={idx} codigo={pais} className="h-3 w-4 shrink-0" />
                            ))}
                          </span>
                        )}
                        <span className="truncate font-medium">{row.teamName ?? row.athletes}</span>
                      </button>
                    </td>
                    <td className="py-3 pr-3">
                      <EstacionActual
                        row={row}
                        progreso={progreso}
                        largadaEpochMs={largada}
                        hayCircuito={puedeAbrir}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <Estado row={row} />
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <Tiempo row={row} />
                    </td>
                  </tr>

                  {desplegado && puedeAbrir && (
                    <tr className="border-b border-neutral-900">
                      <td colSpan={5} className={`bg-neutral-900/40 px-4 py-5 ${barra}`}>
                        {/* Lo que identifica a quien se esta mirando: el detalle
                            de la tabla de CrossFit hace lo mismo arriba de sus
                            parciales. */}
                        <div className="mb-4">
                          <p className="text-base font-semibold text-neutral-100">
                            {row.teamName ?? row.athletes}
                          </p>
                          {row.teamName && row.athletes && (
                            <p className="text-xs text-neutral-400">{row.athletes}</p>
                          )}
                          <p className="text-sm text-neutral-500">
                            #{row.bib} · {row.divisionName}
                            {box && ` · ${box}`}
                          </p>
                        </div>

                        {/* Un poco mas angosto que el panel y centrado: el mapa
                            no necesita tocar los bordes de la tabla. */}
                        <div className="overflow-x-auto">
                          <div className="mx-auto w-[88%]">
                            <LineaDeTiempoDeCircuito
                              progreso={progreso}
                              largadaEpochMs={largada}
                              referencias={referencias}
                              totalMs={row.totalMs}
                              penaltyMs={row.penaltyMs}
                              etiquetaFinal={etiquetaFinal(row)}
                            />
                          </div>
                        </div>
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
 * LA COLUMNA QUE ESTA PANTALLA EXISTE PARA TENER: en que estacion va el atleta,
 * no cuanto tiempo lleva.
 *
 * El nombre de la estacion es el dato; el tiempo que corre debajo es cuanto
 * lleva EN ELLA —no el total de la carrera, que ya esta en la columna de al
 * lado— y sirve para detectar al que se quedo trabado sin tener que mirar el
 * carril.
 */
function EstacionActual({
  row,
  progreso,
  largadaEpochMs,
  hayCircuito,
}: {
  row: LeaderboardRow;
  progreso: ReturnType<typeof progresoDeCircuito>;
  largadaEpochMs: number | null;
  hayCircuito: boolean;
}) {
  if (!hayCircuito) return null;

  // En un celular la fila no da para la barra, el contador y el reloj: queda
  // el NOMBRE de la estacion, que es el dato. El resto vuelve en cuanto hay
  // ancho.
  if (row.status === "idle") {
    return <span className="text-xs text-neutral-600">Sin largar</span>;
  }

  if (!progreso.actual) {
    return (
      <span className="text-xs text-neutral-500">
        {row.status === "finished"
          ? `Terminó las ${progreso.total} estaciones`
          : `Se detuvo en la ${progreso.completados + 1} de ${progreso.total}`}
      </span>
    );
  }

  return (
    <span className="block w-52">
      <span className="block truncate text-sm font-medium text-amber-300">
        {progreso.actual.name}
      </span>
      <span className="mt-1 flex items-center gap-2">
        {/* Cuantas lleva de cuantas, en una barra: con 16 estaciones, "5/16"
            solo se entiende despues de leerlo, y la barra se ve. */}
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-800">
          <span
            className="block h-full rounded-full bg-amber-300/70"
            style={{
              width: `${(progreso.completados / progreso.total) * 100}%`,
            }}
          />
        </span>
        <span className="font-mono text-[11px] text-neutral-500">
          {progreso.completados}/{progreso.total}
        </span>
        <TiempoEnEstacion largadaEpochMs={largadaEpochMs} desdeMs={progreso.desdeMs} />
      </span>
    </span>
  );
}

/**
 * Cuanto lleva el atleta en la estacion donde esta.
 *
 * Al DOM directo con requestAnimationFrame, igual que `LiveClock` y
 * `RelojDeHeat`: esta pantalla puede tener veinte de estos corriendo a la vez y
 * re-renderizar el arbol por cada frame de cada uno no tiene ningun sentido.
 *
 * Usa el reloj de pared para animar —nunca para rankear, que es lo que prohibe
 * la doctrina del proyecto—: el tiempo que puntua sale de `results`, derivado
 * del log de marcajes.
 */
function TiempoEnEstacion({
  largadaEpochMs,
  desdeMs,
}: {
  largadaEpochMs: number | null;
  desdeMs: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (largadaEpochMs === null) return;
    let frame = 0;
    const tick = () => {
      if (ref.current) {
        ref.current.textContent = formatElapsed(
          Math.max(Date.now() - largadaEpochMs - desdeMs, 0),
          {
            centis: false,
          },
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [largadaEpochMs, desdeMs]);

  if (largadaEpochMs === null) return null;

  return (
    <span ref={ref} className="font-mono text-[11px] text-amber-300/80" suppressHydrationWarning />
  );
}

function etiquetaFinal(row: LeaderboardRow): string {
  if (row.status === "dnf") return "DNF";
  if (row.status === "dq") return "DQ";
  return row.totalMs === null ? "—" : formatElapsed(row.totalMs, { centis: false });
}

function Posicion({ row }: { row: LeaderboardRow }) {
  if (row.status !== "finished") {
    return <span className="text-xs text-neutral-600">—</span>;
  }
  const medalla = ["text-amber-300", "text-neutral-300", "text-orange-400"][row.position - 1];
  return (
    <span className={`font-mono text-lg font-bold ${medalla ?? "text-neutral-400"}`}>
      {row.position}
    </span>
  );
}

/** Misma pastilla que la columna "Estado" de la tabla general. */
function Estado({ row }: { row: LeaderboardRow }) {
  const [texto, clase] =
    row.status === "running"
      ? ["En carrera", "bg-amber-400/15 text-amber-300"]
      : row.status === "finished"
        ? ["Terminó", "bg-lime-400/15 text-lime-300"]
        : row.status === "dnf"
          ? ["DNF", "bg-neutral-500/20 text-neutral-300"]
          : row.status === "dq"
            ? ["DQ", "bg-red-500/15 text-red-300"]
            : ["Sin largar", "bg-neutral-500/10 text-neutral-500"];

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${clase}`}
    >
      {texto}
    </span>
  );
}

/** El tiempo total; mientras corre o si no termino no hay tiempo que mostrar. */
function Tiempo({ row }: { row: LeaderboardRow }) {
  if (row.status === "finished" && row.totalMs !== null) {
    return (
      <span className="font-mono text-base font-bold tabular-nums">
        {formatElapsed(row.totalMs)}
      </span>
    );
  }
  return <span className="text-neutral-600">—</span>;
}
