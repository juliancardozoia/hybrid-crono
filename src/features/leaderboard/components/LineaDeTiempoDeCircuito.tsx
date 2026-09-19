"use client";

import { useEffect, useRef } from "react";
import { formatElapsed } from "@/shared/timing/clock";
import { fraccionDelTramo, type ParcialDeCircuito, type ProgresoDeCircuito } from "../lib/circuito";
import { CAJA_ALTO, CAJA_ANCHO, disposicionSerpentina, partirEtiqueta } from "../lib/serpentina";

/**
 * El recorrido completo de un atleta, de la largada a la bandera a cuadros.
 *
 * SERPENTEA PARA NO HACER SCROLL. Un circuito son 16 segmentos: en una columna,
 * tres atletas desplegados ya no entran en la pantalla, y la pregunta que se
 * hace el organizador —"¿donde va cada uno?"— se contesta comparando, o sea
 * viendo varios a la vez. Curvando el recorrido se usa el ANCHO, que es lo que
 * sobra en el panel, y cada atleta ocupa dos o tres lineas.
 *
 * EL INDICADOR DEL TRAMO EN CURSO ES UNA ANIMACION, NO UN DATO. Cuanto le falta
 * al atleta en la estacion donde esta no lo sabe nadie hasta que el juez marca.
 * Por eso el relleno se llena a lo largo de lo que suelen tardar los demas
 * (`duracionesDeReferencia`) y, al alcanzarlo, VUELVE A EMPEZAR (ver
 * `fraccionDelTramo`): quedarse lleno y quieto se lee como "trabado" o como
 * "ya termino". El tiempo que se muestra debajo es el REAL —cuanto lleva en la
 * estacion—: la animacion orienta, el numero es el dato.
 *
 * El relleno en vivo se escribe DIRECTO AL NODO con requestAnimationFrame, sin
 * pasar por el estado de React: es la misma regla de rendimiento que
 * `LiveClock` y `RelojDeHeat`, y aca pesa igual porque la pantalla puede tener
 * veinte atletas desplegados a la vez.
 */
export function LineaDeTiempoDeCircuito({
  progreso,
  largadaEpochMs,
  referencias,
  totalMs,
  penaltyMs,
  etiquetaFinal,
}: {
  progreso: ProgresoDeCircuito;
  /**
   * Reloj de pared de la largada del heat. Se usa SOLO para animar: el tiempo
   * que rankea sale de `results`, derivado del log de marcajes, y nunca de
   * aca. Es el mismo permiso que ya se toma `RelojDeHeat` en la torre de
   * control.
   */
  largadaEpochMs: number | null;
  /** Cuanto suele durar cada segmento, por `orderIndex`. Para el indicador en vivo. */
  referencias: Map<number, number>;
  totalMs: number | null;
  penaltyMs: number;
  /** "DNF", "DQ" o el tiempo total. Lo que va junto a la bandera a cuadros. */
  etiquetaFinal: string;
}) {
  const { parciales, indiceActual, desdeMs } = progreso;
  const disposicion = disposicionSerpentina(parciales.length);

  const rellenoRef = useRef<SVGRectElement>(null);
  const relojRef = useRef<SVGTextElement>(null);
  const referenciaActual =
    indiceActual === null
      ? null
      : (referencias.get(parciales[indiceActual].segmento.orderIndex) ?? null);

  useEffect(() => {
    if (indiceActual === null || largadaEpochMs === null) return;

    let frame = 0;
    const tick = () => {
      const enLaEstacion = Date.now() - largadaEpochMs - desdeMs;
      if (rellenoRef.current) {
        const ancho = CAJA_ANCHO * fraccionDelTramo(enLaEstacion, referenciaActual);
        rellenoRef.current.setAttribute("width", String(Math.max(ancho, 0)));
      }
      // Sin centesimas: a la escala de "en que estacion va" importan los
      // segundos, igual que el reloj del heat en la torre de control.
      if (relojRef.current) {
        relojRef.current.textContent = formatElapsed(Math.max(enLaEstacion, 0), { centis: false });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [indiceActual, largadaEpochMs, desdeMs, referenciaActual]);

  if (parciales.length === 0) return null;

  const primero = parciales[0];
  const ultimo = parciales[parciales.length - 1];
  // La meta sale por el borde por el que se recorrio la ultima fila, asi que
  // la bandera va del lado de afuera y no encima del recorrido.
  const haciaLaDerecha = disposicion.meta.x > disposicion.ancho / 2;

  return (
    <svg
      viewBox={`0 0 ${disposicion.ancho} ${disposicion.alto}`}
      className="h-auto w-full"
      // Ocupa TODO el ancho del panel y escala con el; el minimo evita que en un
      // celular se encoja hasta que el nombre de la estacion no se lea (ahi el
      // contenedor desplaza en horizontal).
      style={{ minWidth: disposicion.ancho * 0.75 }}
      role="img"
      aria-label={resumenAccesible(progreso)}
    >
      {/* Los tramos se pintan ANTES que las cajas para que queden por debajo. */}
      {disposicion.conectores.map((c) => (
        <path
          key={c.desde}
          d={c.d}
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          className={
            parciales[c.desde]?.estado === "hecho" ? "stroke-lime-400/60" : "stroke-neutral-800"
          }
        />
      ))}

      <path
        d={`M ${disposicion.largada.x - 30} ${disposicion.largada.y} H ${disposicion.largada.x}`}
        strokeWidth={2.5}
        strokeLinecap="round"
        className={primero.estado === "pendiente" ? "stroke-neutral-800" : "stroke-lime-400/60"}
      />
      <text
        x={disposicion.largada.x - 30}
        y={disposicion.largada.y - 10}
        className="fill-neutral-500 text-[9px] font-semibold tracking-wider uppercase"
      >
        Start
      </text>

      <path
        d={`M ${disposicion.meta.x} ${disposicion.meta.y} H ${
          disposicion.meta.x + (haciaLaDerecha ? 30 : -30)
        }`}
        strokeWidth={2.5}
        strokeLinecap="round"
        className={ultimo.estado === "hecho" ? "stroke-lime-400/60" : "stroke-neutral-800"}
      />
      <BanderaACuadros
        x={disposicion.meta.x + (haciaLaDerecha ? 30 : -42)}
        y={disposicion.meta.y - 6}
        etiqueta={etiquetaFinal}
        terminado={ultimo.estado === "hecho"}
      />

      {disposicion.cajas.map((caja) => {
        const parcial = parciales[caja.indice];
        const enCurso = parcial.estado === "en_curso";
        const hecho = parcial.estado === "hecho";
        // Una corrida se dibuja con las esquinas redondeadas y una estacion con
        // las esquinas rectas: distingue las dos de un vistazo sin sumarle una
        // etiqueta mas a cada caja.
        const radio = parcial.segmento.kind === "run" ? CAJA_ALTO / 2 : 8;
        const lineas = partirEtiqueta(parcial.segmento.name, 15, 2);

        return (
          <g key={parcial.segmento.id}>
            <title>{tituloDeCaja(parcial, caja.indice)}</title>

            <rect
              x={caja.x}
              y={caja.y}
              width={CAJA_ANCHO}
              height={CAJA_ALTO}
              rx={radio}
              strokeWidth={enCurso ? 2 : 1.5}
              className={
                hecho
                  ? "fill-lime-400/10 stroke-lime-400/50"
                  : enCurso
                    ? "fill-amber-400/5 stroke-amber-300"
                    : "fill-neutral-950 stroke-neutral-800"
              }
            />

            {enCurso && (
              <>
                <clipPath id={`tramo-${parcial.segmento.id}`}>
                  <rect x={caja.x} y={caja.y} width={CAJA_ANCHO} height={CAJA_ALTO} rx={radio} />
                </clipPath>
                <rect
                  ref={rellenoRef}
                  x={caja.x}
                  y={caja.y}
                  width={0}
                  height={CAJA_ALTO}
                  clipPath={`url(#tramo-${parcial.segmento.id})`}
                  className="fill-amber-300/20"
                />
              </>
            )}

            <text
              x={caja.cx}
              y={caja.cy}
              textAnchor="middle"
              className={
                hecho
                  ? "fill-neutral-200 text-[11px]"
                  : enCurso
                    ? "fill-amber-100 text-[11px] font-semibold"
                    : "fill-neutral-500 text-[11px]"
              }
            >
              {lineas.map((linea, i) => (
                <tspan
                  key={i}
                  x={caja.cx}
                  // Una sola linea se centra en la caja; dos se reparten arriba
                  // y abajo del centro.
                  dy={i === 0 ? (lineas.length === 1 ? 4 : -2) : 13}
                >
                  {linea}
                </tspan>
              ))}
            </text>

            {hecho && parcial.durationMs !== null && (
              <text
                x={caja.cx}
                y={caja.y + CAJA_ALTO + 15}
                textAnchor="middle"
                className="fill-neutral-400 font-mono text-[11px]"
              >
                {formatElapsed(parcial.durationMs, { centis: false })}
              </text>
            )}
            {enCurso && (
              <text
                ref={relojRef}
                x={caja.cx}
                y={caja.y + CAJA_ALTO + 15}
                textAnchor="middle"
                className="fill-amber-300 font-mono text-[11px] font-semibold"
                suppressHydrationWarning
              >
                {formatElapsed(0, { centis: false })}
              </text>
            )}
          </g>
        );
      })}

      {/* La penalizacion no es un segmento: se suma al total y se dice aparte,
          para que la suma de los parciales no parezca estar mal. */}
      {penaltyMs > 0 && (
        <text
          x={disposicion.ancho - 4}
          y={disposicion.alto - 4}
          textAnchor="end"
          className="fill-amber-400 text-[10px]"
        >
          {`+${formatElapsed(penaltyMs, { centis: false })} de penalización${
            totalMs === null ? "" : ", ya incluida en el total"
          }`}
        </text>
      )}
    </svg>
  );
}

function BanderaACuadros({
  x,
  y,
  etiqueta,
  terminado,
}: {
  x: number;
  y: number;
  etiqueta: string;
  terminado: boolean;
}) {
  const lado = 6;
  return (
    <g opacity={terminado ? 1 : 0.35}>
      {[0, 1].map((fila) =>
        [0, 1].map((col) => (
          <rect
            key={`${fila}-${col}`}
            x={x + col * lado}
            y={y + fila * lado}
            width={lado}
            height={lado}
            className={(fila + col) % 2 === 0 ? "fill-neutral-200" : "fill-neutral-700"}
          />
        )),
      )}
      <text
        x={x + lado}
        y={y + lado * 2 + 14}
        textAnchor="middle"
        className={
          terminado
            ? "fill-neutral-100 font-mono text-[11px] font-bold"
            : "fill-neutral-600 font-mono text-[11px]"
        }
      >
        {etiqueta}
      </text>
    </g>
  );
}

function tituloDeCaja(parcial: ParcialDeCircuito, indice: number): string {
  const encabezado = `${indice + 1}. ${parcial.segmento.name}`;
  if (parcial.estado === "en_curso") return `${encabezado} — en curso`;
  if (parcial.durationMs === null || parcial.cumulativeMs === null) return encabezado;
  return `${encabezado} — ${formatElapsed(parcial.durationMs)} (acumulado ${formatElapsed(
    parcial.cumulativeMs,
  )})`;
}

/**
 * Lo que anuncia un lector de pantalla. El SVG es un dibujo: sin esto, quien no
 * lo ve se queda sin el dato que la pantalla existe para dar.
 */
function resumenAccesible(progreso: ProgresoDeCircuito): string {
  if (progreso.actual) {
    return `Estación ${(progreso.indiceActual ?? 0) + 1} de ${progreso.total}: ${progreso.actual.name}, en curso.`;
  }
  return `${progreso.completados} de ${progreso.total} estaciones completadas.`;
}
