import { planDelWod } from "@/shared/timing/wod";
import { armarEstructuraDeWod } from "@/shared/timing/wodStructure";
import { formatearCarga } from "@/shared/unidades/carga";
import type { PartBlockRow, PartMovementRow, WorkoutPartRow } from "@/lib/supabase/types";

/**
 * El WOD como lo va a ver el juez, al lado del constructor.
 *
 * POR QUE VALE LA PENA. Un error de carga —una escalera invertida, un objetivo
 * que quedó en 0, un movimiento que se va a tapear cien veces— hoy se descubre
 * el día de la competencia, con el juez en el piso y el atleta esperando. Acá
 * se ve al cargarlo.
 *
 * Sale GRATIS: `planDelWod` es la misma función pura que despliega los pasos en
 * el celular del juez. No hay una segunda versión de esto que pueda divergir —
 * si la vista previa miente, el juez ve lo mismo que miente.
 *
 * Usa los valores BASE del movimiento, sin ajustes de categoría: la vista es de
 * la prueba, y los pesos por categoría tienen su propia grilla abajo.
 */

const ESTILO: Record<string, { texto: string; clase: string }> = {
  tap: { texto: "un toque por rep", clase: "text-lime-300" },
  hecho: { texto: "un toque al terminar", clase: "text-sky-300" },
  numero: { texto: "escribe la cantidad", clase: "text-amber-300" },
};

const UNIDAD: Record<string, string> = {
  reps: "",
  metros: " m",
  calorias: " cal",
  segundos: " s",
  kg: " kg",
};

export function VistaPreviaDelWod({
  part,
  blocks,
  movements,
  nombres,
}: {
  part: WorkoutPartRow;
  blocks: PartBlockRow[];
  movements: PartMovementRow[];
  /** Nombre del catálogo por id de movimiento. */
  nombres: Map<string, string>;
}) {
  const estructura = armarEstructuraDeWod({
    parte: part,
    bloques: blocks,
    movimientos: movements,
    nombres,
    specs: new Map(),
  });

  const plan = planDelWod(estructura);

  // En un AMRAP, `bloque.rounds` no es una decision del organizador: es un
  // techo interno que el constructor completa solo (ver `repeticionesDelBloque`
  // en `workouts/actions.ts`) porque el reductor no tiene forma de desplegar
  // "rondas ilimitadas". Desplegar las 50 rondas ACA seria mostrar un plan que
  // no existe -el atleta hace las que pueda, no 50- asi que se muestra una
  // sola ronda con una nota, en vez de la lista entera.
  const esAmrap = estructura.scheme === "ventana";
  const ventanaEnMinutos = estructura.windowMs ? estructura.windowMs / 60_000 : null;

  // Los bloques de descanso no generan pasos -`planDelWod` los saltea a
  // proposito, porque no se marcan- pero eso los dejaba invisibles TAMBIEN
  // aca, en la vista previa. Un bloque de descanso entre dos de trabajo
  // desaparecia de la lista y parecia que las dos partes iban seguidas sin
  // pausa. Se intercalan como un separador, en el orden real del WOD, usando
  // los mismos bloques que ya recibe el componente -no un segundo calculo.
  const bloquesOrdenados = [...blocks].sort((a, b) => a.order_index - b.order_index);

  const grupos = bloquesOrdenados.map((bloque) => {
    const pasosDelBloque = plan.filter((p) => p.blockId === bloque.id);
    const seRepite = esAmrap && bloque.repeticiones > 1;
    return {
      bloque,
      seRepite,
      pasos: seRepite ? pasosDelBloque.filter((p) => p.round === 1) : pasosDelBloque,
    };
  });

  const totalPasosMostrados = grupos.reduce((suma, g) => suma + g.pasos.length, 0);

  if (totalPasosMostrados === 0 && !bloquesOrdenados.some((b) => b.kind === "descanso")) {
    return (
      <p className="rounded-2xl border border-dashed border-neutral-800 p-4 text-center text-sm text-neutral-600">
        Sin pasos todavía. Agrega un bloque con sus movimientos y acá vas a ver
        exactamente lo que va a marcar el juez.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-neutral-500">
        {totalPasosMostrados} paso{totalPasosMostrados === 1 ? "" : "s"} — lo
        que el juez va a marcar, en orden.
      </p>

      <ol className="flex flex-col divide-y divide-neutral-900 overflow-hidden rounded-2xl border border-neutral-800">
        {grupos.flatMap(({ bloque, seRepite, pasos }) => {
          if (bloque.kind === "descanso") {
            return (
              <li
                key={bloque.id}
                className="bg-neutral-900/60 px-4 py-2 text-xs font-medium tracking-wide text-neutral-500 uppercase"
              >
                Descanso
                {bloque.duracion_ms !== null && ` — ${bloque.duracion_ms / 1000} s`}
                <span className="ml-2 normal-case text-neutral-600">
                  (no se marca: el reloj sigue corriendo)
                </span>
              </li>
            );
          }

          const filas = pasos.map((paso, i) => {
            const estilo = ESTILO[paso.captureStyle];
            // Separador de ronda: es lo que deja confirmar ANTES del día de la
            // competencia que "21-15-9" armó tres rondas y no algo distinto —
            // sin esto la lista es plana y no dice dónde empieza cada una.
            // Solo con más de una ronda REAL: en un AMRAP no hay "ronda X de
            // Y" que mostrar, es la nota de "se repite" la que ya lo dice.
            const empiezaRonda =
              !seRepite &&
              paso.totalRounds > 1 &&
              (i === 0 || pasos[i - 1].round !== paso.round);
            return (
              <li key={paso.index}>
                {empiezaRonda && (
                  <p className="bg-neutral-900/70 px-4 py-1 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                    Ronda {paso.round} de {paso.totalRounds}
                  </p>
                )}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <span className="w-6 shrink-0 font-mono text-xs text-neutral-600">
                    {paso.index + 1}
                  </span>
                  <span className="font-mono text-neutral-400">
                    {paso.maxReps ? "máx" : `${paso.target}${UNIDAD[paso.unit] ?? ""}`}
                  </span>
                  <span className="font-medium">{paso.name}</span>
                  {paso.loadKg !== null && (
                    <span className="text-neutral-400">
                      {formatearCarga(paso.loadKg, paso.loadUnit)}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    {paso.isTiebreak && (
                      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                        desempate
                      </span>
                    )}
                    <span className={estilo?.clase ?? "text-neutral-500"}>
                      {estilo?.texto ?? paso.captureStyle}
                    </span>
                  </span>
                </div>
              </li>
            );
          });

          if (seRepite) {
            filas.push(
              <li
                key={`${bloque.id}-se-repite`}
                className="bg-neutral-900/60 px-4 py-2 text-xs font-medium tracking-wide text-neutral-500 uppercase"
              >
                ↻ Se repite hasta agotar el tiempo
                {ventanaEnMinutos !== null && ` (ventana: ${ventanaEnMinutos} min)`}
              </li>,
            );
          }

          return filas;
        })}
      </ol>
    </div>
  );
}
