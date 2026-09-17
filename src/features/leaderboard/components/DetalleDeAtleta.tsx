import { Badge } from "@/shared/components/Badge";
import { Icono } from "@/shared/components/Icono";
import type { ScoreboardDivision, ScoreboardPart } from "@/shared/scoring/scoreboard";
import type { PartPlacement, RoundBreakdownStep } from "@/shared/scoring/types";
import { formatElapsed } from "@/shared/timing/clock";
import type { FilaDeEquipo } from "../lib/tabla";

/** 🥇🥈🥉 para el podio, y nada para el resto -- no hay medalla de cuarto puesto. */
export const MEDALLAS = ["🥇", "🥈", "🥉"];

/**
 * El resultado CRUDO de una prueba, tal como se cronometro o se cargo --
 * "08:21", "184 reps", "142 kg" -- en vez del puesto. Usa `puesto.value` (sin
 * normalizar, ver `PartPlacement` en shared/scoring/types.ts): el ranking sale
 * siempre de `comparable`, esto es solo para el detalle del atleta.
 */
export function formatearResultado(parte: ScoreboardPart, puesto: PartPlacement): string | null {
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
export function DesgloseDeRonda({
  rondaActual,
  pasos,
}: {
  rondaActual: number;
  pasos: RoundBreakdownStep[];
}) {
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

export function formatearUnidad(unidad: string, valor: number): string {
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
 * El detalle de UN atleta/equipo: posicion general, puntos, y una tarjeta por
 * WOD con su resultado crudo. La usan la fila expandible de `TablaGeneral`
 * (el organizador viendo a todos) y la pagina de resultado personal del
 * atleta (`/en-vivo/[slug]/atleta/[bib]`, un formato de CrossFit) -- mismo
 * componente, para que las dos vistas nunca puedan mostrar un dato distinto
 * del mismo equipo.
 */
export function DetalleDelAtleta({
  fila,
  parts,
  fieldSize,
  division,
}: {
  fila: FilaDeEquipo;
  parts: ScoreboardPart[];
  fieldSize: number;
  division: ScoreboardDivision;
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
          // en vez del mismo gris neutro para los tres estados.
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
                    configuro en /pruebas) -- la tabla principal del
                    organizador conserva "WOD 1", "WOD 2"... a proposito. */}
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
                  del contenido de arriba. */}
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

export function EstadisticaResumen({
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
