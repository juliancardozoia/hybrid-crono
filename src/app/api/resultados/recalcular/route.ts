import { NextResponse } from "next/server";
import { recomputeLanes } from "@/features/verification/lib/recompute";

/**
 * Recalcula el cache de resultados de un carril o de un heat.
 *
 * Existe como ruta HTTP porque la llama el celular del juez apenas sincroniza,
 * sin esperar la respuesta. Toda la logica vive en recomputeLanes(): esto es
 * solo la puerta de entrada.
 */
export async function POST(request: Request) {
  let body: { laneId?: string; heatId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  if (!body.laneId && !body.heatId) {
    return NextResponse.json({ error: "Falta laneId o heatId" }, { status: 400 });
  }

  const { recalculados, error } = await recomputeLanes(body);

  if (error === "Sin sesion") {
    return NextResponse.json({ error }, { status: 401 });
  }
  if (error === "Sin carriles") {
    return NextResponse.json({ error: "Carril no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ recalculados });
}
