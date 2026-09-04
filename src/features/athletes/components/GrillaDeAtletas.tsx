"use client";

import { useMemo, useState } from "react";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { BotonCopiar } from "@/shared/components/BotonCopiar";
import { Bandera } from "@/shared/components/Bandera";
import { Icono } from "@/shared/components/Icono";
import type { TeamWithMembers } from "@/features/events/config/queries";
import type { FormState } from "@/features/athletes/actions";

/** Solo dígitos, con el código de país si ya lo trae: lo que espera wa.me. */
function numeroDeWhatsapp(telefono: string): string {
  return telefono.replace(/[^0-9]/g, "");
}

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
 *
 * PAGINADO DE A 20. Con una competencia de verdad (80, 200 atletas) la tabla
 * entera scrollea sin fin. El numero de pagina NO se resetea con un efecto al
 * cambiar el filtro: se CLAMPEA en el render (`Math.min(pagina, totalPaginas)`),
 * asi que filtrar a una sola pagina de resultados estando en la 3 la muestra
 * bien sin un `useEffect` de por medio, y volver a vaciar el filtro devuelve
 * la pagina de antes en vez de siempre arrancar en 1.
 */
const POR_PAGINA = 20;

export function GrillaDeAtletas({
  teams,
  divisiones,
  canManage,
  alQuitar,
  alCambiarAprobacion,
}: {
  teams: TeamWithMembers[];
  divisiones: Array<{ id: string; name: string }>;
  canManage: boolean;
  alQuitar?: (
    teamId: string,
    prev: FormState,
    formData: FormData,
  ) => Promise<FormState>;
  /** El toggle de la columna "Estado": aprueba o desaprueba un equipo. Solo
   *  un equipo aprobado puede asignarse a un heat. */
  alCambiarAprobacion?: (
    teamId: string,
    approved: boolean,
    prev: FormState,
    formData: FormData,
  ) => Promise<FormState>;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [divisionId, setDivisionId] = useState("");
  const [pagina, setPagina] = useState(1);

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

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaValida = Math.min(pagina, totalPaginas);
  const visibles = filtrados.slice(
    (paginaValida - 1) * POR_PAGINA,
    paginaValida * POR_PAGINA,
  );

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
            <option value="">Todas las categorías</option>
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
          <table className="w-full min-w-[50rem] text-sm">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-900/40 text-left text-neutral-500">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-3 py-3 font-medium">Atleta / Equipo</th>
                <th className="px-3 py-3 font-medium">Categoría</th>
                <th className="px-3 py-3 font-medium">Estado</th>
                <th className="px-3 py-3 font-medium">Correo</th>
                <th className="px-3 py-3 font-medium">WhatsApp</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-neutral-900 last:border-0"
                >
                  <td className="px-4 py-3 font-mono font-bold tabular-nums">
                    {t.bib_number}
                  </td>
                  <td className="px-3 py-3">
                    {t.name && (
                      <p className="mb-1 font-medium">{t.name}</p>
                    )}
                    {t.members.length === 0 ? (
                      <p className="text-neutral-400">sin integrantes</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {t.members.map((m) => (
                          <p
                            key={m.id}
                            className={`flex h-[1.625rem] items-center gap-1.5 ${t.name ? "text-neutral-400" : ""}`}
                          >
                            <Bandera codigo={m.country} className="h-3 w-4 shrink-0" />
                            <span>
                              {m.first_name} {m.last_name}
                            </span>
                          </p>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-neutral-400">
                    {t.divisionName}
                  </td>
                  <td className="px-3 py-3">
                    {canManage && alCambiarAprobacion ? (
                      <FormularioDeEstado
                        accion={alCambiarAprobacion.bind(
                          null,
                          t.id,
                          !t.approved,
                        )}
                        estadoInicial={{ error: null }}
                        etiqueta={t.approved ? "Aprobado" : "Pendiente"}
                        pendienteTexto="…"
                        mensajeDeCarga={
                          t.approved ? "Marcando pendiente…" : "Aprobando…"
                        }
                        title={
                          t.approved
                            ? "Click para marcar pendiente"
                            : "Click para aprobar — solo un equipo aprobado puede asignarse a un heat"
                        }
                        className={
                          t.approved
                            ? "rounded-full bg-lime-400/15 px-3 py-1.5 text-xs font-semibold text-lime-400 hover:bg-lime-400/25"
                            : "rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-400/25"
                        }
                      />
                    ) : (
                      <span
                        className={`text-xs font-semibold ${t.approved ? "text-lime-400" : "text-amber-400"}`}
                      >
                        {t.approved ? "Aprobado" : "Pendiente"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {t.members.length === 0 ? (
                      <span className="text-neutral-600">—</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {t.members.map((m) => (
                          <div key={m.id} className="flex h-[1.625rem] items-center">
                            {m.email ? (
                              <BotonCopiar valor={m.email} titulo={`Copiar correo: ${m.email}`} />
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {t.members.length === 0 ? (
                      <span className="text-neutral-600">—</span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {t.members.map((m) => (
                          <div key={m.id} className="flex h-[1.625rem] items-center">
                            {m.phone ? (
                              <a
                                href={`https://wa.me/${numeroDeWhatsapp(m.phone)}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                title={`Escribir por WhatsApp a ${m.first_name}`}
                                className="rounded-lg p-1 text-emerald-500 transition-colors hover:bg-neutral-800 hover:text-emerald-400"
                              >
                                <Icono nombre="whatsapp" className="h-5 w-5" grosor={1.6} />
                              </a>
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
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

      {filtrados.length > POR_PAGINA && (
        <div className="flex items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={paginaValida <= 1}
            className="rounded-xl border border-neutral-700 px-4 py-2 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Anterior
          </button>
          <span className="text-neutral-500">
            Página {paginaValida} de {totalPaginas}
          </span>
          <button
            type="button"
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={paginaValida >= totalPaginas}
            className="rounded-xl border border-neutral-700 px-4 py-2 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
