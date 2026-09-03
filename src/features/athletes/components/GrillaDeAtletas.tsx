"use client";

import { useMemo, useState } from "react";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import type { TeamWithMembers } from "@/features/events/config/queries";
import type { FormState } from "@/features/athletes/actions";

/**
 * El padron, en una grilla con buscador y filtro.
 *
 * ANTES ERA UNA LISTA SIN BUSCADOR. Funciona bien con veinte equipos; con
 * doscientos —una competencia grande, o el dia del evento con el celular en
 * la mano y alguien reclamando su dorsal— hace falta poder escribir un nombre
 * y encontrarlo. El filtrado es del lado del cliente: el padron completo de un
 * evento (cientos de filas, no miles) ya viaja en la carga de la pagina, asi
 * que filtrarlo en el navegador es instantaneo y no pide una consulta nueva
 * por cada letra.
 */
export function GrillaDeAtletas({
  teams,
  divisiones,
  canManage,
  alQuitar,
}: {
  teams: TeamWithMembers[];
  divisiones: Array<{ id: string; name: string }>;
  canManage: boolean;
  alQuitar?: (
    teamId: string,
    prev: FormState,
    formData: FormData,
  ) => Promise<FormState>;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [divisionId, setDivisionId] = useState("");

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    return teams.filter((t) => {
      if (divisionId && t.division_id !== divisionId) return false;
      if (!texto) return true;

      const dorsal = String(t.bib_number);
      const nombres = [
        t.name ?? "",
        ...t.members.flatMap((m) => [
          `${m.first_name} ${m.last_name}`,
          m.email ?? "",
          m.document_id ?? "",
        ]),
      ];

      return (
        dorsal.includes(texto) ||
        nombres.some((n) => n.toLowerCase().includes(texto))
      );
    });
  }, [teams, busqueda, divisionId]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, correo, DNI o dorsal…"
          className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400"
        />
        {divisiones.length > 1 && (
          <select
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            className="w-auto appearance-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-lime-400"
          >
            <option value="">Todas las divisiones</option>
            {divisiones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {teams.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Todavía no hay inscriptos.
        </p>
      ) : filtrados.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-6 text-center text-sm text-neutral-500">
          Nada coincide con la búsqueda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-neutral-800">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/40 text-left text-neutral-500">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-3 py-3 font-medium">Nombre / Equipo</th>
                <th className="px-3 py-3 font-medium">División</th>
                <th className="px-3 py-3 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">Documento</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtrados.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-neutral-900 last:border-0"
                >
                  <td className="px-4 py-3 font-mono font-bold tabular-nums">
                    {t.bib_number}
                  </td>
                  <td className="px-3 py-3">
                    {t.name && (
                      <span className="mr-2 font-medium">{t.name}</span>
                    )}
                    <span className={t.name ? "text-neutral-400" : ""}>
                      {t.members
                        .map((m) => `${m.first_name} ${m.last_name}`)
                        .join(" / ") || "sin integrantes"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-neutral-400">
                    {t.divisionName}
                  </td>
                  <td className="px-3 py-3 text-neutral-400">
                    {t.members
                      .map((m) => m.email)
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                  <td className="px-3 py-3 text-neutral-400">
                    {t.members
                      .map((m) => m.document_id)
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage && alQuitar && (
                      <FormularioDeEstado
                        accion={alQuitar.bind(null, t.id)}
                        estadoInicial={{ error: null }}
                        etiqueta="✕"
                        pendienteTexto="…"
                        mensajeDeCarga="Quitando el equipo…"
                        title="Quitar equipo"
                        className="px-2 text-neutral-600 hover:text-red-400"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
