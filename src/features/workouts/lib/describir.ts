import type { WorkoutPartRow } from "@/lib/supabase/types";
import type { ScoreDirDb, ScoreUnitDb, TimeScheme } from "@/lib/supabase/types";

/**
 * Traduce la definicion de una prueba a como la nombra la gente del deporte.
 *
 * La base guarda esquema + unidad + direccion porque es lo unico que el motor
 * necesita, pero nadie le dice a un WOD "ventana / rondas_reps / mayor_gana":
 * le dice AMRAP. Esta funcion existe para que la pantalla hable el idioma del
 * organizador sin que el modelo tenga que enumerar formatos.
 */

const ESQUEMA: Record<TimeScheme, string> = {
  circuito: "Circuito cronometrado",
  libre: "For Time",
  cap: "For Time con cap",
  ventana: "AMRAP",
  intervalos: "Intervalos",
  sin_reloj: "Carga máxima",
};

export const UNIDAD: Record<ScoreUnitDb, string> = {
  tiempo: "tiempo",
  reps: "repeticiones",
  rondas: "rondas",
  rondas_reps: "rondas + reps",
  carga: "kilos",
  distancia: "metros",
  calorias: "calorías",
  puntos: "puntos",
};

const DIRECCION: Record<ScoreDirDb, string> = {
  menor_gana: "menos es mejor",
  mayor_gana: "más es mejor",
};

function minutos(ms: number | null): string | null {
  if (!ms) return null;
  const total = ms / 60_000;
  return Number.isInteger(total) ? `${total} min` : `${(ms / 1000).toFixed(0)} s`;
}

export function describirParte(parte: WorkoutPartRow): string {
  const partes = [ESQUEMA[parte.time_scheme]];

  const ventana = minutos(parte.window_ms);
  if (ventana) partes.push(`de ${ventana}`);

  const cap = minutos(parte.time_cap_ms);
  if (cap) partes.push(`cap ${cap}`);

  if (parte.interval_ms) partes.push(`cada ${Math.round(parte.interval_ms / 1000)} s`);

  partes.push(`· ${UNIDAD[parte.score_unit]}, ${DIRECCION[parte.score_dir]}`);

  if (parte.capture_mode === "en_vivo") partes.push("· en vivo");

  return partes.join(" ");
}
