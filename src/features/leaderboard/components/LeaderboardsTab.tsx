"use client";

import { useState } from "react";
import { Selector } from "@/shared/components/Selector";
import { LeaderboardLive } from "./LeaderboardLive";
import { TablaGeneral } from "./TablaGeneral";
import { ListaDeLargada } from "@/features/catalogo/components/ListaDeLargada";
import type { Leaderboard, TablaGeneral as DatosGenerales } from "../queries";
import type { Inscritos } from "@/features/catalogo/queries";

/**
 * La pestaña publica "Leaderboards" completa: titulo + UN filtro de
 * categoria, iguales a los de la pestaña "Workouts" (PanelDeWorkouts).
 *
 * ANTES CADA VISTA TENIA SU PROPIO FILTRO. `LeaderboardLive`, `TablaGeneral`
 * y `ListaDeLargada` dibujaban cada una su propio "Categoría" -- hasta tres
 * selectores en la misma pantalla, y ninguno decia "Leaderboards" en ningun
 * lado (la pestaña lo dice arriba, pero el contenido no lo repetia en
 * ningun titulo propio). Este componente le saca el filtro a cada una
 * (siguen aceptandolo sin controlar para el panel del organizador y
 * `/en-vivo`, que lo usan standalone) y pone UN titulo + UN Selector que
 * maneja las tres vistas a la vez.
 *
 * LAS OPCIONES DEL FILTRO DEPENDEN DE QUE VISTA ESTA ACTIVA. Con resultados,
 * es la union de las categorias que tienen fila en el leaderboard de tiempos
 * Y en la tabla general -- un WOD de CrossFit no deja fila en `results`, asi
 * que una categoria puede estar en una y no en la otra. Sin resultados, son
 * las categorias con inscritos.
 */
export function LeaderboardsTab({
  slug,
  eventName,
  leaderboard,
  general,
  inscritos,
}: {
  slug: string;
  eventName: string;
  leaderboard: Leaderboard;
  general: DatosGenerales;
  inscritos: Inscritos | null;
}) {
  const hayResultados = leaderboard.rows.length > 0 || general.divisiones.length > 0;

  const opciones = hayResultados
    ? [...new Set([...leaderboard.divisions, ...general.divisiones.map((d) => d.division.name)])].sort()
    : (inscritos?.divisiones.filter((d) => d.equipos.length > 0).map((d) => d.nombre) ?? []);

  const [categoria, setCategoria] = useState<string | null>(opciones[0] ?? null);
  // Si las opciones cambian (llega la primera categoria recien ahora) y lo
  // elegido ya no es valido, cae a la primera en vez de quedar en un valor
  // que no existe.
  const categoriaActiva = (categoria && opciones.includes(categoria) ? categoria : opciones[0]) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Leaderboards</h2>

        {opciones.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Categoría</span>
            <Selector
              value={categoriaActiva ?? ""}
              onChange={(e) => setCategoria(e.target.value)}
              className="min-w-0 flex-1 py-2 text-sm sm:flex-none"
            >
              {opciones.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Selector>
          </label>
        )}
      </div>

      {hayResultados ? (
        <div className="flex flex-col gap-4">
          {/* `LeaderboardLive` lee `results`, que solo llenan las pruebas de
              CIRCUITO. Un evento sin ninguna -- todo CrossFit -- deja
              `leaderboard.rows` vacio para siempre, y mostrarlo solo le
              roba el lugar a la tabla general, que es la unica con datos. */}
          {leaderboard.rows.length > 0 && (
            <LeaderboardLive
              slug={slug}
              inicial={leaderboard}
              eventName={eventName}
              compacto
              categoria={categoriaActiva ?? undefined}
            />
          )}
          <TablaGeneral slug={slug} inicial={general} categoria={categoriaActiva ?? undefined} />
        </div>
      ) : inscritos ? (
        <ListaDeLargada datos={inscritos} categoria={categoriaActiva ?? undefined} />
      ) : null}
    </div>
  );
}
