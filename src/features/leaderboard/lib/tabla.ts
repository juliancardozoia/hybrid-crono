import type { ScoreboardDivision, ScoreboardPart } from "@/shared/scoring/scoreboard";
import type { TablaGeneral } from "../queries";

export type EntradaConEquipo = TablaGeneral["divisiones"][number]["entries"][number];
export type EstadoDeEquipo = "activo" | "eliminado";

/**
 * Una fila FUSIONADA de la tabla general: la categoria puede tener varias
 * entradas en `data.divisiones` (una por etapa, cuando hubo un corte), pero
 * para quien mira un equipo puntual es SIEMPRE una sola fila. `entry` es la
 * del equipo en su etapa VIGENTE -- la final si sigue adentro, la ultima que
 * corrio si quedo eliminado en el camino -- y `porEtapa` guarda todas sus
 * entradas para poder buscar el resultado de un WOD de una etapa anterior (un
 * finalista sigue mostrando lo que hizo en el WOD 1 de la clasificatoria).
 */
export interface FilaDeEquipo {
  teamId: string;
  entry: EntradaConEquipo;
  estado: EstadoDeEquipo;
  etapaVigente: number;
  porEtapa: Map<number, EntradaConEquipo>;
}

export interface TablaDeDivision {
  division: ScoreboardDivision;
  filas: FilaDeEquipo[];
  /** Union acumulada de las partes de todas las etapas hasta la final inclusive. */
  partes: ScoreboardPart[];
  /** Cuantos equipos siguen activos -- el "field" contra el que se mide un puesto. */
  fieldSize: number;
  /**
   * Cuantos equipos corrieron CADA etapa -- un eliminado en la Etapa 1 se
   * mide contra el field DE LA ETAPA 1, no contra el de la final en la que ya
   * no participa.
   */
  camposPorEtapa: Map<number, number>;
}

/**
 * Arma la tabla de UNA categoria a partir del documento crudo de
 * `getTablaGeneral()`: fusiona las entradas de cada etapa en una fila por
 * equipo, decide quien sigue activo y quien quedo eliminado, y junta las
 * partes acumuladas.
 *
 * Es la MISMA logica que ya usaba `TablaGeneral.tsx` para pintar la tabla
 * completa del organizador, extraida aca para que la pagina de resultado
 * personal del atleta (`/en-vivo/[slug]/atleta/[bib]`, que solo necesita la
 * fila de UN equipo) no tenga que reimplementar "que cuenta como eliminado" o
 * "en que etapa quedo" -- si cada pantalla lo decidiera por su cuenta, un dia
 * podrian divergir.
 */
export function tablaDeDivision(datos: TablaGeneral, divisionId: string): TablaDeDivision | null {
  const gruposOrdenados = datos.divisiones
    .filter((d) => d.division.id === divisionId)
    .sort((a, b) => a.stage - b.stage);

  const etapaFinal = gruposOrdenados[gruposOrdenados.length - 1];
  if (!etapaFinal) return null;

  const idsActivos = new Set(etapaFinal.entries.map((e) => e.teamId));

  const entradasPorEquipo = new Map<string, Map<number, EntradaConEquipo>>();
  for (const grupo of gruposOrdenados) {
    for (const entry of grupo.entries) {
      const porEtapa = entradasPorEquipo.get(entry.teamId) ?? new Map<number, EntradaConEquipo>();
      porEtapa.set(grupo.stage, entry);
      entradasPorEquipo.set(entry.teamId, porEtapa);
    }
  }

  const filas: FilaDeEquipo[] = [...entradasPorEquipo.entries()].map(([teamId, porEtapa]) => {
    const etapaVigente = Math.max(...porEtapa.keys());
    return {
      teamId,
      // El `!` es seguro: etapaVigente sale de las claves del mismo mapa.
      entry: porEtapa.get(etapaVigente)!,
      estado: idsActivos.has(teamId) ? "activo" : ("eliminado" as EstadoDeEquipo),
      etapaVigente,
      porEtapa,
    };
  });

  // Activos primero (por su posicion vigente); los eliminados despues,
  // agrupados por en que etapa quedaron afuera.
  filas.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === "activo" ? -1 : 1;
    if (a.etapaVigente !== b.etapaVigente) return b.etapaVigente - a.etapaVigente;
    return a.entry.position - b.entry.position;
  });

  const camposPorEtapa = new Map(gruposOrdenados.map((g) => [g.stage, g.entries.length]));

  return {
    division: etapaFinal.division,
    filas,
    partes: etapaFinal.parts,
    fieldSize: etapaFinal.entries.length,
    camposPorEtapa,
  };
}

/**
 * Numera por WORKOUT, no por parte: dos partes del mismo WOD (A/B) comparten
 * numero y se distinguen por su `label`, en vez de contar "WOD 3" y "WOD 4"
 * para lo que en la pizarra es un solo WOD.
 */
export function numerarWorkouts(partes: ScoreboardPart[]): Map<string, number> {
  const numeroDeWorkout = new Map<string, number>();
  for (const p of partes) {
    if (!numeroDeWorkout.has(p.workoutId)) numeroDeWorkout.set(p.workoutId, numeroDeWorkout.size + 1);
  }
  return numeroDeWorkout;
}
