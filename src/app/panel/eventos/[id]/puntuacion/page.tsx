import { requireEventAccess } from "@/features/events/lib/access";
import { getPuntuacionDelEvento } from "@/features/events/config/queries";
import {
  PuntuacionDelEvento,
  SelectorDePoliticaDeEmpate,
} from "@/features/events/components/PuntuacionDelEvento";

export const dynamic = "force-dynamic";

/**
 * Como se reparten los puntos.
 *
 * NO OFRECE ELEGIR LA CURVA porque hay una sola: la de los CrossFit Games
 * 2026 adaptada al tamaño real de cada categoría. Lo que sí se decide acá:
 * cuándo se congela esa curva y con cuántos atletas (para que retirarse a
 * mitad de competencia no le cambie los puntos a nadie), y cómo cobra un
 * grupo empatado (`SelectorDePoliticaDeEmpate` — ver `TiePointPolicy`).
 *
 * Una carrera híbrida no tiene nada que configurar acá: se gana llegando
 * antes, no repartiendo puntos.
 */
export default async function PuntuacionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { event } = await requireEventAccess(id);

  if (event.format === "carrera_hibrida") {
    return (
      <div className="flex flex-col gap-3">
        <Encabezado />
        <p className="rounded-2xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-500">
          Es una carrera: el resultado es el tiempo del circuito y gana quien
          llega antes. No hay puntos que repartir ni tabla que configurar.
        </p>
      </div>
    );
  }

  const categorias = await getPuntuacionDelEvento(id);

  return (
    <div className="flex flex-col gap-5">
      <Encabezado />
      <SelectorDePoliticaDeEmpate eventId={id} policy={event.tie_point_policy} />
      <PuntuacionDelEvento eventId={id} categorias={categorias} />
    </div>
  );
}

function Encabezado() {
  return (
    <div>
      <h2 className="text-xl font-bold">Puntuación</h2>
      <p className="mt-1 max-w-2xl text-sm text-neutral-400">
        <span className="font-medium text-neutral-300">Games 2026 Dynamic.</span>{" "}
        El 1.º saca 100 puntos y el último 0, con la curva de los CrossFit Games
        2026 ajustada a la cantidad de atletas de cada categoría.
      </p>
    </div>
  );
}
