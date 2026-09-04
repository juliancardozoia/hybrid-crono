"use client";

import { useMemo, useState } from "react";
import { HeatCard, type TeamOption } from "./HeatCard";
import { NuevoHeat } from "./NuevoHeat";
import { DistribuirHeats } from "./DistribuirHeats";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import type { HeatWithLanes, JudgeOption } from "@/features/events/config/queries";

interface FormState {
  error: string | null;
}

type AccionQuitar = (
  eventId: string,
  heatId: string,
  prev: FormState,
  formData: FormData,
) => Promise<FormState>;

/**
 * La pantalla de heats: filtro por categoría en una sola fila junto con las
 * dos acciones de alta, y la lista agrupada debajo.
 *
 * ES CLIENTE por el filtro. Con quince heats o más repartidos en varias
 * categorías, una lista plana obliga a leerla entera para encontrar la
 * propia — el mismo motivo que ya llevó a la torre de control a este mismo
 * patrón (filtro + reloj en vivo en un componente de cliente que recibe los
 * datos ya resueltos del servidor).
 */
export function PantallaDeHeats({
  eventId,
  timezone,
  divisiones,
  heats,
  opciones,
  judges,
  canManage,
  canVerify,
  quitarHeat,
}: {
  eventId: string;
  timezone: string;
  divisiones: Array<{ id: string; name: string }>;
  heats: HeatWithLanes[];
  opciones: TeamOption[];
  judges: JudgeOption[];
  canManage: boolean;
  canVerify: boolean;
  quitarHeat: AccionQuitar;
}) {
  const [divisionId, setDivisionId] = useState("");

  const nombreDivision = useMemo(
    () => new Map(divisiones.map((d) => [d.id, d.name])),
    [divisiones],
  );

  // Solo se ofrecen las categorías que ya tienen algún heat: elegir una
  // vacía en el filtro solo mostraría "sin heats todavía" sin decir por qué.
  const divisionesConHeat = useMemo(() => {
    const ids = new Set(heats.map((h) => h.division_id).filter((x): x is string => Boolean(x)));
    return divisiones.filter((d) => ids.has(d.id));
  }, [divisiones, heats]);

  const visibles = divisionId ? heats.filter((h) => h.division_id === divisionId) : heats;

  const grupos = useMemo(() => {
    const mapa = new Map<string, HeatWithLanes[]>();
    for (const heat of visibles) {
      const clave = heat.division_id ?? "";
      mapa.set(clave, [...(mapa.get(clave) ?? []), heat]);
    }
    return mapa;
  }, [visibles]);

  const clavesOrdenadas = useMemo(
    () =>
      [...grupos.keys()].sort((a, b) => {
        if (a === "") return 1;
        if (b === "") return -1;
        return (nombreDivision.get(a) ?? "").localeCompare(nombreDivision.get(b) ?? "");
      }),
    [grupos, nombreDivision],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Una sola fila, a todo el ancho: el filtro a la izquierda, las dos
          acciones de alta a la derecha. En celular se apila. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        {divisionesConHeat.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-neutral-500">Categoría</span>
            <select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            >
              <option value="">Todas</option>
              {divisionesConHeat.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}

        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <DistribuirHeats eventId={eventId} />
            <NuevoHeat eventId={eventId} divisiones={divisiones} />
          </div>
        )}
      </div>

      {heats.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Sin heats todavía.
        </p>
      ) : visibles.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Ninguna categoría coincide.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {clavesOrdenadas.map((clave) => (
            <section key={clave || "sin-categoria"} className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold tracking-wide text-neutral-400 uppercase">
                {clave ? (nombreDivision.get(clave) ?? "Categoría") : "Sin categoría"}
              </h2>

              {(grupos.get(clave) ?? []).map((heat) => (
                <div key={heat.id} className="relative">
                  <HeatCard
                    eventId={eventId}
                    timezone={timezone}
                    heat={heat}
                    teams={opciones}
                    judges={judges}
                    canManage={canManage}
                    canVerify={canVerify}
                  />
                  {canManage && heat.started_at === null && (
                    <div className="absolute top-4 right-4">
                      <FormularioDeEstado
                        accion={quitarHeat.bind(null, eventId, heat.id)}
                        estadoInicial={{ error: null }}
                        etiqueta="✕"
                        pendienteTexto="…"
                        mensajeDeCarga="Quitando el heat…"
                        title="Quitar heat"
                        className="text-sm text-neutral-700 hover:text-red-400"
                      />
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
