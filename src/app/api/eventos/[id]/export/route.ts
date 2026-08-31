import { formatElapsed } from "@/shared/timing/clock";
import { toCsv } from "@/shared/utils/csv";
import { getEventAccess } from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";

interface SplitJson {
  segmentName?: string;
  orderIndex?: number;
  durationMs?: number;
  cumulativeMs?: number;
}

/**
 * Export de resultados a CSV.
 *
 * Este archivo es el reemplazo directo de la planilla que hoy se transcribe a
 * mano. Incluye los parciales en columnas para que sirva tal cual para prensa,
 * podios y archivo del evento.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const access = await getEventAccess(id);
  if (!access) return new Response("No encontrado", { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("results")
    .select("*, teams (bib_number, name, team_members (athletes (first_name, last_name))), divisions (name)")
    .eq("event_id", id);

  const filas = (data as unknown as Array<Record<string, never>>) ?? [];

  // La cantidad de columnas de parciales la marca el carril con mas segmentos:
  // un evento puede tener divisiones con circuitos distintos.
  const maxSplits = filas.reduce(
    (max, r) => Math.max(max, Array.isArray(r.splits) ? (r.splits as SplitJson[]).length : 0),
    0,
  );

  const enriquecidas = filas.map((r) => {
    const equipo = r.teams as unknown as {
      bib_number: number;
      name: string | null;
      team_members: Array<{ athletes: { first_name: string; last_name: string } | null }>;
    } | null;

    const atletas =
      equipo?.team_members
        .flatMap((m) => (m.athletes ? [`${m.athletes.first_name} ${m.athletes.last_name}`] : []))
        .join(" / ") ?? "";

    return {
      division: (r.divisions as unknown as { name: string } | null)?.name ?? "",
      bib: equipo?.bib_number ?? null,
      equipo: equipo?.name ?? "",
      atletas,
      status: r.status as string,
      totalMs: r.total_ms as number | null,
      rawMs: r.raw_ms as number | null,
      penaltyMs: (r.penalty_ms as number) ?? 0,
      splits: (Array.isArray(r.splits) ? r.splits : []) as SplitJson[],
      verified: Boolean(r.verified_at),
    };
  });

  // Mismo orden que el leaderboard: por division, y dentro por tiempo.
  enriquecidas.sort(
    (a, b) =>
      a.division.localeCompare(b.division) ||
      (a.status === "finished" ? 0 : 1) - (b.status === "finished" ? 0 : 1) ||
      (a.totalMs ?? Infinity) - (b.totalMs ?? Infinity),
  );

  const headers = [
    "Division",
    "Posicion",
    "Dorsal",
    "Equipo",
    "Atletas",
    "Estado",
    "Tiempo bruto",
    "Penalizacion",
    "Tiempo total",
    "Verificado",
    ...Array.from({ length: maxSplits }, (_, i) => `Parcial ${i + 1}`),
    ...Array.from({ length: maxSplits }, (_, i) => `Acumulado ${i + 1}`),
  ];

  const posiciones = new Map<string, number>();

  const rows = enriquecidas.map((r) => {
    let posicion: number | null = null;
    if (r.status === "finished") {
      const n = (posiciones.get(r.division) ?? 0) + 1;
      posiciones.set(r.division, n);
      posicion = n;
    }

    return [
      r.division,
      posicion,
      r.bib,
      r.equipo,
      r.atletas,
      r.status,
      r.rawMs !== null ? formatElapsed(r.rawMs) : "",
      r.penaltyMs > 0 ? formatElapsed(r.penaltyMs, { centis: false }) : "",
      r.totalMs !== null ? formatElapsed(r.totalMs) : "",
      r.verified ? "si" : "no",
      ...Array.from({ length: maxSplits }, (_, i) =>
        r.splits[i]?.durationMs !== undefined ? formatElapsed(r.splits[i].durationMs!) : "",
      ),
      ...Array.from({ length: maxSplits }, (_, i) =>
        r.splits[i]?.cumulativeMs !== undefined ? formatElapsed(r.splits[i].cumulativeMs!) : "",
      ),
    ];
  });

  const nombre = access.event.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();

  return new Response(toCsv(headers, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="resultados-${nombre}.csv"`,
    },
  });
}
