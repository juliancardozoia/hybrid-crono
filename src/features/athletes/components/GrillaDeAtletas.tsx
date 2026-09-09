"use client";

import { Fragment, useMemo, useState } from "react";
import { FormularioDeEstado } from "@/shared/components/FormularioDeEstado";
import { Boton, claseDeBoton } from "@/shared/components/Boton";
import { BotonCopiar } from "@/shared/components/BotonCopiar";
import { Bandera } from "@/shared/components/Bandera";
import { Icono } from "@/shared/components/Icono";
import { Modal } from "@/shared/components/Modal";
import { Selector } from "@/shared/components/Selector";
import {
  DetalleDeAtleta,
  type DivisionParaDetalle,
} from "@/features/athletes/components/DetalleDeAtleta";
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
  divisiones: DivisionParaDetalle[];
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
  // Acordeon de a uno: abrir un registro cierra el anterior, asi la grilla no
  // termina con diez detalles desplegados a la vez.
  const [expandido, setExpandido] = useState<string | null>(null);

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
          <Selector
            value={divisionId}
            onChange={(e) => setDivisionId(e.target.value)}
            className="w-auto py-2 text-sm"
          >
            <option value="">Todas las categorías</option>
            {divisiones.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Selector>
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
              {visibles.map((t) => {
                const abierto = expandido === t.id;
                return (
                <Fragment key={t.id}>
                <tr className="border-b border-neutral-900 last:border-0">
                  <td className="px-4 py-3 font-mono font-bold tabular-nums">
                    {t.bib_number}
                  </td>
                  <td className="px-3 py-3">
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandido((actual) => (actual === t.id ? null : t.id))
                        }
                        className="flex w-full items-start gap-2 text-left"
                        aria-expanded={abierto}
                        title={abierto ? "Ocultar detalle" : "Ver y editar detalle"}
                      >
                        <Icono
                          nombre="flecha"
                          className={`mt-1 h-3 w-3 shrink-0 text-neutral-500 transition-transform ${
                            abierto ? "rotate-90" : ""
                          }`}
                        />
                        <ContenidoDelEquipo t={t} />
                      </button>
                    ) : (
                      <ContenidoDelEquipo t={t} />
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
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canManage && alQuitar && <QuitarEquipo equipo={t} alQuitar={alQuitar} />}
                  </td>
                </tr>

                {/* El detalle se despliega EN EL LUGAR, no en un modal aparte:
                    el organizador ya esta mirando la fila. */}
                {abierto && (
                  <tr className="border-b border-neutral-900 last:border-0">
                    <td colSpan={7} className="bg-neutral-900/40 px-4 py-5">
                      <DetalleDeAtleta
                        eventId={t.event_id}
                        team={t}
                        divisiones={divisiones}
                        alCerrar={() => setExpandido(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
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

/**
 * Quitar un equipo, con confirmacion.
 *
 * ANTES DISPARABA LA ACCION DIRECTO AL CLICK. Es irreversible —el equipo sale
 * del evento— y el boton "✕" vivia en una celda angosta pegada a "Categoría" y
 * "Correo" en una tabla densa: un toque desviado, sobre todo en celular, lo
 * alcanzaba sin querer.
 */
function QuitarEquipo({
  equipo,
  alQuitar,
}: {
  equipo: TeamWithMembers;
  alQuitar: (teamId: string, prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const nombre = equipo.name ?? `#${equipo.bib_number}`;

  return (
    <>
      {/* No es `Boton`: ninguna variante existente combina "neutral en reposo,
          rojo solo al hover" — inventar una variante para un solo caso
          concreto es la excepcion que el primitive deberia evitar, no
          generar. El tamaño (44px) ya sigue el minimo tactil formalizado. */}
      <button
        type="button"
        onClick={() => setConfirmar(true)}
        title="Quitar equipo"
        className="flex h-11 w-11 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-900 hover:text-red-400"
      >
        ✕
      </button>

      <Modal
        abierto={confirmar}
        alCerrar={() => setConfirmar(false)}
        titulo="Quitar equipo"
        ancho="max-w-sm"
      >
        <div className="text-left">
          <p className="text-sm text-neutral-300">
            ¿Quitar a <span className="font-medium">{nombre}</span> de la competencia? Se pierde
            su dorsal y su lugar en cualquier heat. Esta acción no se puede deshacer.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton variante="secondary" compacto onClick={() => setConfirmar(false)}>
              Cancelar
            </Boton>
            <FormularioDeEstado
              accion={alQuitar.bind(null, equipo.id)}
              estadoInicial={{ error: null }}
              etiqueta="Quitar equipo"
              mensajeDeCarga="Quitando el equipo…"
              className={claseDeBoton({ variante: "destructive", compacto: true })}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

/** El nombre del equipo y sus integrantes: se pinta igual adentro y afuera
 *  del botón que despliega el detalle (sin botón cuando no se puede editar). */
function ContenidoDelEquipo({ t }: { t: TeamWithMembers }) {
  return (
    <span className="min-w-0 flex-1">
      {t.name && <span className="mb-1 block font-medium">{t.name}</span>}
      {t.members.length === 0 ? (
        <span className="block text-neutral-400">sin integrantes</span>
      ) : (
        <span className="flex flex-col gap-1.5">
          {t.members.map((m) => (
            <span
              key={m.id}
              className={`flex h-[1.625rem] items-center gap-1.5 ${t.name ? "text-neutral-400" : ""}`}
            >
              <Bandera codigo={m.country} className="h-3 w-4 shrink-0" />
              <span>
                {m.first_name} {m.last_name}
              </span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
