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

  if (plan.length === 0) {
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
        {plan.length} paso{plan.length === 1 ? "" : "s"} — lo que el juez va a
        marcar, en orden.
      </p>

      <ol className="flex flex-col divide-y divide-neutral-900 overflow-hidden rounded-2xl border border-neutral-800">
        {plan.map((paso, i) => {
          const estilo = ESTILO[paso.captureStyle];
          // Separador de ronda: es lo que deja confirmar ANTES del día de la
          // competencia que "21-15-9" armó tres rondas y no algo distinto —
          // sin esto la lista es plana y no dice dónde empieza cada una.
          // Solo con más de una ronda: con una sola, "Ronda 1 de 1" no
          // agrega nada.
          const empiezaRonda =
            paso.totalRounds > 1 && (i === 0 || plan[i - 1].round !== paso.round);
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
        })}
      </ol>
    </div>
  );
}
