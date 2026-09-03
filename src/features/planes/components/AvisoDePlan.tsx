import Link from "next/link";
import type { EstadoDelPlan } from "../queries";

/**
 * Le dice al organizador que le esta limitando el plan, en el lugar donde lo
 * nota.
 *
 * Es informativo a proposito: la restriccion real vive en Postgres y ya rechaza
 * la operacion. Esta pantalla existe para que el "no" llegue antes de intentarlo
 * y con la salida al lado, en vez de aparecer como un error rojo despues de
 * cargar media prueba.
 *
 * No se muestra nada en plan pro: un cartel permanente que dice "todo bien" es
 * ruido.
 */
export function AvisoDePlan({
  estado,
  motivo,
}: {
  estado: EstadoDelPlan | null;
  motivo: "en_vivo" | "publicar" | "resultados";
}) {
  if (!estado || estado.plan === "pro") return null;

  const TEXTOS: Record<typeof motivo, { titulo: string; detalle: string }> = {
    en_vivo: {
      titulo: "Los WODs se cargan a mano",
      detalle:
        "Con el plan gratuito el juez cronometra los circuitos igual que siempre, pero los WODs de CrossFit se puntúan cargando el resultado a mano al terminar.",
    },
    publicar: {
      titulo: "Esta competencia no aparece en el catálogo",
      detalle:
        "El catálogo público es del plan Pro. Tu competencia funciona completa igual: se configura, se cronometra y se verifica; solo no queda listada para que la encuentren atletas nuevos.",
    },
    resultados: {
      titulo: "Sin leaderboard en vivo",
      detalle:
        "Con el plan gratuito los resultados se muestran al público recién cuando publicas los oficiales, y sin parciales ni ficha por atleta. Los tiempos se toman y se consolidan igual.",
    },
  };

  const { titulo, detalle } = TEXTOS[motivo];

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-4">
      <p className="text-sm font-semibold text-neutral-200">{titulo}</p>
      <p className="mt-1 text-sm text-neutral-400">{detalle}</p>
      <Link
        href="/panel/organizacion/plan"
        className="mt-3 inline-block text-sm text-lime-400 hover:underline"
      >
        Ver planes →
      </Link>
    </div>
  );
}
