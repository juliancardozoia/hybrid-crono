"use client";

import { useState, useTransition } from "react";
import {
  bloquearTablaDePuntuacion,
  generarTablaDePuntuacion,
} from "../config/puntuacion";
import { confirmarCorteDeEtapa } from "../config/etapas";
import type { EtapaDeCategoria, PuntuacionDeCategoria } from "../config/queries";
import { puntosDinamicos } from "@/shared/scoring/points";
import { huellaDelStanding } from "@/shared/scoring/hash";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { Modal } from "@/shared/components/Modal";
import { Badge } from "@/shared/components/Badge";
import { claseDeBoton } from "@/shared/components/Boton";

/**
 * Como se reparten los puntos, por categoria.
 *
 * HAY UN SOLO SISTEMA Y NO SE ELIGE. Lo que el organizador decide aca es otra
 * cosa: con cuantos atletas se congela la curva de cada categoria y cuando se
 * bloquea. Por eso la pantalla no tiene un selector de sistema arriba — tendria
 * una sola opcion — y si tiene, por categoria, las dos cifras que hay que poder
 * comparar de un vistazo: con cuantos se congelo y cuantos hay hoy.
 */
export function PuntuacionDelEvento({
  eventId,
  categorias,
}: {
  eventId: string;
  categorias: PuntuacionDeCategoria[];
}) {
  if (categorias.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
        Todavía no hay categorías. Creá las categorías y acá vas a poder ver y
        congelar la tabla de puntos de cada una.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {categorias.map((c) => (
        <TarjetaDeCategoria key={c.divisionId} eventId={eventId} categoria={c} />
      ))}
    </div>
  );
}

function TarjetaDeCategoria({
  eventId,
  categoria,
}: {
  eventId: string;
  categoria: PuntuacionDeCategoria;
}) {
  const [pendiente, startTransition] = useTransition();
  const [verTabla, setVerTabla] = useState(false);
  const [manual, setManual] = useState("");
  const { exito, error: avisarError } = useNotificaciones();

  // Lo que se va a congelar: lo que el organizador escriba, o los atletas que
  // hay. "Automático" es el default porque es lo correcto el 99% de las veces;
  // el manual existe para una categoría que todavía está por completarse.
  const escrito = Number(manual);
  const fieldSize =
    manual.trim() !== "" && Number.isFinite(escrito) && escrito >= 1
      ? Math.floor(escrito)
      : categoria.atletasActivos;

  // La curva que se ve: la congelada si ya existe, o la que se generaría.
  const tabla = categoria.snapshot ?? (fieldSize >= 1 ? puntosDinamicos(fieldSize) : []);

  const correr = (accion: () => Promise<{ error: string | null }>, mensaje: string) =>
    startTransition(async () => {
      const r = await accion();
      if (r.error) avisarError(r.error);
      else exito(mensaje);
    });

  const sinAtletas = categoria.atletasActivos === 0 && categoria.snapshot === null;

  return (
    <section className="rounded-2xl border border-neutral-800 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{categoria.nombre}</h3>
          <p className="mt-0.5 text-sm text-neutral-500">
            {categoria.atletasActivos} atleta{categoria.atletasActivos === 1 ? "" : "s"} ahora
            {categoria.fieldSize !== null && (
              <>
                {" · "}
                <span className={desfasada(categoria) ? "text-amber-400" : ""}>
                  tabla congelada con {categoria.fieldSize}
                </span>
              </>
            )}
          </p>
        </div>

        <Estado categoria={categoria} />
      </div>

      {desfasada(categoria) &&
        (crecioSobreElSnapshot(categoria) ? (
          <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-200/90">
            La tabla se congeló con {categoria.fieldSize} y hoy hay{" "}
            {categoria.atletasActivos}: {categoria.atletasActivos - (categoria.fieldSize ?? 0)} atleta
            {categoria.atletasActivos - (categoria.fieldSize ?? 0) === 1 ? "" : "s"} de mas quedarian
            puntuando en cero, sin que nadie lo note. La tabla general de esta categoria NO se
            actualiza mientras esto siga asi. Sacalos de la categoria, o regenerá y volvé a bloquear
            la tabla con el tamaño real.
          </p>
        ) : (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/90">
            La tabla se congeló con {categoria.fieldSize} y hoy hay{" "}
            {categoria.atletasActivos}. Es lo esperado si alguien se retiró después de
            empezar: los puntos de las pruebas ya corridas no se tocan.
          </p>
        ))}

      {/* Todo en una sola fila: el label va AL LADO del input, no arriba, y el
          texto de ayuda pasa a `title` (tooltip). Con el label arriba y la
          ayuda abajo, ese bloque medía 3 lineas de alto contra 1 de los
          botones, y alineados con `items-end` los botones quedaban pegados
          al texto de ayuda en vez de al input -- de ahi el desalineado. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!categoria.bloqueada && (
          <label
            className="flex items-center gap-2 text-sm font-medium"
            title="Vacío = los atletas que haya al generar."
          >
            Tamaño
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder={`Automático (${categoria.atletasActivos})`}
              className="w-36 rounded-xl border border-neutral-800 bg-transparent px-3 py-2.5 text-sm outline-none transition-colors focus:border-lime-400"
            />
          </label>
        )}

        <button
          type="button"
          onClick={() => setVerTabla(true)}
          disabled={tabla.length === 0}
          className={claseDeBoton({ variante: "secondary", compacto: true })}
        >
          Ver tabla ({tabla.length} puestos)
        </button>

        {!categoria.bloqueada && (
          <>
            <button
              type="button"
              disabled={pendiente || sinAtletas}
              onClick={() =>
                correr(
                  () => generarTablaDePuntuacion(eventId, categoria.divisionId, fieldSize, false),
                  "Tabla generada.",
                )
              }
              className={claseDeBoton({ variante: "secondary", compacto: true })}
            >
              {categoria.snapshot ? "Regenerar" : "Generar"}
            </button>

            <button
              type="button"
              disabled={pendiente || sinAtletas}
              onClick={() =>
                correr(
                  () =>
                    categoria.snapshot
                      ? bloquearTablaDePuntuacion(eventId, categoria.divisionId)
                      : generarTablaDePuntuacion(
                          eventId,
                          categoria.divisionId,
                          fieldSize,
                          true,
                        ),
                  "Tabla bloqueada.",
                )
              }
              className={claseDeBoton({ variante: "primary", compacto: true })}
            >
              Generar y bloquear
            </button>
          </>
        )}
      </div>

      {sinAtletas && (
        <p className="mt-3 text-xs text-neutral-600">
          Sin atletas inscritos todavía no hay tabla que congelar.
        </p>
      )}

      <EtapasDeCategoria eventId={eventId} divisionId={categoria.divisionId} etapas={categoria.etapas} />

      <Modal
        abierto={verTabla}
        alCerrar={() => setVerTabla(false)}
        titulo={`Puntos · ${categoria.nombre}`}
        ancho="max-w-sm"
      >
        <div className="max-h-[60dvh] overflow-y-auto text-left">
          <p className="mb-3 text-xs text-neutral-500">
            {categoria.bloqueada
              ? "Tabla congelada: estos son los puntos que se reparten."
              : "Previsualización: así quedaría la tabla si la generás ahora."}
          </p>
          <ol className="flex flex-col divide-y divide-neutral-900 rounded-xl border border-neutral-800">
            {tabla.map((puntos, i) => (
              <li key={i} className="flex items-baseline justify-between px-3 py-1.5 text-sm">
                <span className="text-neutral-500">{i + 1}.º</span>
                <span className="font-mono tabular-nums">{formatear(puntos)}</span>
              </li>
            ))}
          </ol>
        </div>
      </Modal>
    </section>
  );
}

function Estado({ categoria }: { categoria: PuntuacionDeCategoria }) {
  if (categoria.bloqueada) {
    return <Badge tono="activo">Bloqueada</Badge>;
  }
  if (categoria.snapshot) {
    return <Badge tono="neutral">Generada, sin bloquear</Badge>;
  }
  // No es un Badge: sin relleno, es el estado "todavia no hay nada que
  // mostrar" — forzarlo al mismo molde que los otros dos inventaria una
  // variante de Badge (sin fondo, solo borde) que no se usa en ningun otro
  // lado de la app.
  return (
    <span className="rounded-lg border border-neutral-800 px-2.5 py-1 text-xs text-neutral-500">
      Se calcula al vuelo
    </span>
  );
}

/** La tabla se congelo con un numero de atletas distinto del de hoy. */
function desfasada(c: PuntuacionDeCategoria): boolean {
  return c.fieldSize !== null && c.fieldSize !== c.atletasActivos;
}

/**
 * El field creció por ENCIMA de lo que describe el snapshot congelado -- la
 * unica direccion que bloquea (ver `detectarFieldMismatch` en
 * src/shared/scoring/points.ts). Que el field sea MENOR es legitimo (un
 * retiro) y no bloquea nada: `desfasada` ya lo avisa sin frenar.
 */
function crecioSobreElSnapshot(c: PuntuacionDeCategoria): boolean {
  return c.fieldSize !== null && c.atletasActivos > c.fieldSize;
}

/** Dos decimales para leer, tres para calcular. */
function formatear(puntos: number): string {
  return Number.isInteger(puntos) ? String(puntos) : puntos.toFixed(2);
}

/**
 * Los cortes de una categoria: "Stage 1 con 40 -> cut -> Stage 2 con 20".
 *
 * Vacio para la enorme mayoria de las competencias, que no tienen mas de una
 * etapa — no aparece nada. Solo se muestra si alguna prueba del evento se
 * asigno a una etapa 2 o mayor (se configura en "Editar prueba", en Pruebas).
 */
function EtapasDeCategoria({
  eventId,
  divisionId,
  etapas,
}: {
  eventId: string;
  divisionId: string;
  etapas: EtapaDeCategoria[];
}) {
  if (etapas.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-neutral-800 pt-4">
      <h4 className="text-sm font-semibold text-neutral-400 uppercase">Etapas y cortes</h4>
      {etapas.map((etapa) => (
        <BloqueDeEtapa key={etapa.stage} eventId={eventId} divisionId={divisionId} etapa={etapa} />
      ))}
    </div>
  );
}

function BloqueDeEtapa({
  eventId,
  divisionId,
  etapa,
}: {
  eventId: string;
  divisionId: string;
  etapa: EtapaDeCategoria;
}) {
  const [pendiente, startTransition] = useTransition();
  const [puestoStr, setPuestoStr] = useState("");
  const { exito, error: avisarError } = useNotificaciones();

  // Confirmado: no se puede rehacer, mismo criterio que bloquear la tabla de
  // puntos. Se muestra la lista de quien avanzo, sin nada mas que tocar.
  if (etapa.avanzan) {
    return (
      <div className="rounded-xl border border-neutral-800 p-3">
        <p className="text-sm font-medium">
          Etapa {etapa.stage} · {etapa.avanzan.length} equipo
          {etapa.avanzan.length === 1 ? "" : "s"} avanzó
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          El corte ya se confirmó y no se puede rehacer.
        </p>
      </div>
    );
  }

  const puesto = Number(puestoStr);
  const puestoValido = Number.isFinite(puesto) && puesto >= 1;

  // La derivacion es UNA comparacion: `position <= puesto`. Como los
  // empatados COMPARTEN `position` (posicion fisica), un grupo que cruza la
  // linea de corte queda ENTERO adentro -- no hay forma de partirlo, porque
  // no hay ninguna seleccion manual que pueda hacerlo.
  const avanzan = puestoValido
    ? etapa.pool.filter((t) => t.position !== null && t.position <= puesto)
    : [];
  // El puesto REAL en el que termina el corte, si un empate lo empujo mas
  // alla del numero que se escribio (ej: se pidio 20 pero el grupo de la
  // frontera ocupa 19-21 y avanzan los 21).
  const puestoReal = avanzan.reduce((max, t) => Math.max(max, t.position ?? 0), 0);
  const seExpandioPorEmpate = puestoValido && puestoReal > 0 && puestoReal !== puesto;

  return (
    <div className="rounded-xl border border-neutral-800 p-3">
      <p className="text-sm font-medium">Etapa {etapa.stage} · puesto de corte</p>

      {etapa.pool.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          Todavía no hay equipos elegibles: confirmá primero el corte de la etapa anterior.
        </p>
      ) : !etapa.etapaAnteriorTerminada ? (
        // Mismo criterio que exige el servidor al guardar
        // (`confirmar_corte_de_etapa`): sin esto, la pantalla dejaba armar
        // toda la seleccion para recien enterarse del rechazo al confirmar.
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-200/90">
          Todavía no se puede confirmar este corte: falta que todos los atletas o equipos activos terminen
          la etapa anterior.
        </p>
      ) : (
        <>
          {etapa.pool.every((t) => t.position === null) && (
            <p className="mt-2 text-xs text-neutral-500">
              Todavía no hay ningún resultado cargado: el orden de abajo no refleja ningún
              acumulado.
            </p>
          )}

          <label className="mt-2 flex items-center gap-2 text-sm">
            Avanzan los primeros
            <input
              value={puestoStr}
              onChange={(e) => setPuestoStr(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="20"
              className="w-16 rounded-lg border border-neutral-800 bg-transparent px-2 py-1 text-center text-sm outline-none focus:border-lime-400"
            />
            puestos
          </label>

          {puestoValido && (
            <p className="mt-1 text-xs text-neutral-500">
              Avanzan <span className="font-medium text-lime-400">{avanzan.length}</span> equipo
              {avanzan.length === 1 ? "" : "s"}
              {seExpandioPorEmpate && (
                <>
                  {" "}
                  (empate en el puesto {puestoReal}: el corte se estira para no partir el grupo)
                </>
              )}
              . Ningún equipo se puede quitar a mano: si el resultado de alguien tiene que cambiar, se
              corrige el score, no el corte.
            </p>
          )}

          {/* Ordenado por el acumulado real hasta esta etapa (no solo el
              ultimo WOD): es la misma cifra que va a usar el leaderboard, asi
              que el corte se confirma mirando el mismo numero, no una lista
              de bibs sin orden. Sin checkboxes: el puesto de arriba es la
              UNICA forma de decidir quien avanza. */}
          <ul className="mt-2 flex flex-col divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800">
            {etapa.pool.map((t) => {
              const avanzaEsteEquipo = avanzan.some((a) => a.teamId === t.teamId);
              return (
                <li key={t.teamId}>
                  <div
                    className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-xs ${
                      avanzaEsteEquipo ? "bg-lime-400/10 text-lime-300" : "text-neutral-400"
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      {/* Ancho fijo: sin esto, un equipo en el puesto 1 y otro
                          en el 12 arrancaban el nombre en columnas distintas
                          -- "1.º" y "12.º" no pesan lo mismo. */}
                      <span className="inline-block w-8 shrink-0 font-mono tabular-nums text-neutral-600">
                        {t.position !== null ? `${t.position}.º` : "—"}
                      </span>
                      {avanzaEsteEquipo ? "✓ " : ""}#{t.bib} {t.nombre ?? ""}
                    </span>
                    {t.totalPoints !== null && (
                      <span className="font-mono tabular-nums text-neutral-500">
                        {formatear(t.totalPoints)} pts
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            disabled={pendiente || !puestoValido || avanzan.length === 0}
            onClick={() =>
              startTransition(async () => {
                // La huella es de LO QUE ESTA PANTALLA MUESTRA -- si el
                // servidor recalcula y le da otra, alguien cambio un score
                // desde que se abrio esta vista, y el corte se rechaza en
                // vez de confirmarse sobre datos que ya quedaron viejos.
                const entradas = etapa.pool
                  .filter((t): t is typeof t & { position: number; totalPoints: number } =>
                    t.position !== null && t.totalPoints !== null,
                  )
                  .map((t) => ({ teamId: t.teamId, position: t.position, totalPoints: t.totalPoints }));
                const huella = huellaDelStanding(entradas);
                const r = await confirmarCorteDeEtapa(eventId, divisionId, etapa.stage, puesto, huella);
                if (r.error) avisarError(r.error);
                else exito("Corte confirmado.");
              })
            }
            className={`mt-3 ${claseDeBoton({ variante: "primary", compacto: true })}`}
          >
            Confirmar corte ({avanzan.length})
          </button>
        </>
      )}
    </div>
  );
}
