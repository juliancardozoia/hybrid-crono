"use client";

import { useState, useTransition } from "react";
import { guardarSpecs } from "../actions";
import { objetivoDeCelda, type CeldaDeSpec } from "../lib/pesos";
import { Boton } from "@/shared/components/Boton";
import { Selector } from "@/shared/components/Selector";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { desdeKilos } from "@/shared/unidades/carga";
import { CATEGORIA, type OpcionDeMovimiento } from "./NuevoMovimiento";
import type { LoadUnit } from "@/lib/supabase/types";

/**
 * Los pesos, las cantidades y la VARIANTE de movimiento de cada categoría, en
 * UNA TARJETA POR CATEGORÍA.
 *
 * `division_movement_specs` es la tabla que hace Rx contra Scaled. La leen el
 * juez y el recálculo del servidor, la muestra la ficha pública — y no tenía
 * NINGÚN camino de escritura: todas las categorías juzgaban con el mismo peso.
 *
 * POR QUÉ TARJETAS Y NO UNA GRILLA "movimiento × categoría". Con cuatro o
 * cinco categorías la grilla entraba en una pantalla; con ocho o diez —nada
 * raro en un CrossFit grande— la columna de movimientos quedaba fija a la
 * izquierda y el resto exigía scroll horizontal, y como todas las categorías
 * compartían la misma FILA, abrir la variante de movimiento en una sola celda
 * estiraba la fila entera para las demás. Una tarjeta por categoría hace que
 * cada una ocupe solo el alto que necesita, y agrupa lo que un organizador
 * piensa junto: "esto es lo que corre Scaled", no "esto es lo que pasa con
 * Thruster en las seis categorías a la vez".
 *
 * UN SOLO "Guardar pesos" al pie, para las tarjetas. Un formulario por
 * categoría serían diez botones idénticos sin nada que distinga cuál está
 * pendiente — el mismo problema que ya llevó a juntar los precios de las
 * categorías en un solo envío.
 *
 * EL VALOR BASE VA DE `placeholder`, NUNCA DE `value`. Vacío significa
 * "heredar", y borrar el campo borra el ajuste. Si el base viniera cargado como
 * valor, abrir la pantalla y guardar convertiría todas las herencias en copias
 * fijas, y cambiar el peso base después ya no se propagaría a nadie.
 *
 * LA VARIANTE DE MOVIMIENTO REEMPLAZA EL NOMBRE, NO ABRE UNA CAJA APARTE. El
 * link "Variar" vive al lado del nombre del movimiento; tocarlo convierte ESE
 * nombre en un selector, y elegir una opción lo cierra solo, dejando el
 * nombre nuevo en su lugar — el mismo gesto que "click para editar" en vez de
 * un formulario que hay que abrir y cerrar a mano. "Otro (escribir)" es la
 * única opción que se queda abierta, porque todavía hace falta el texto.
 *
 * NO va dentro de un `<form action={...}>`: React 19 llama al `form.reset()`
 * nativo al terminar y esta pantalla tiene que CONSERVAR lo recién guardado.
 */

export interface MovimientoDeLaGrilla {
  id: string;
  nombre: string;
  /** Lo que hace el movimiento si la categoría no lo cambia. */
  objetivoBase: number[];
  cargaBaseKg: number | null;
  cargaBaseUnidad: LoadUnit;
  admiteCarga: boolean;
}

export interface CategoriaDeLaGrilla {
  id: string;
  nombre: string;
}

export interface ValorDeCelda {
  objetivo: string;
  carga: string;
  /** "" = el mismo movimiento de la fila. Un id del catálogo, o "otro". */
  movimientoId: string;
  /** Solo cuando `movimientoId === "otro"`. */
  movimientoTexto: string;
}

const CELDA_VACIA: ValorDeCelda = {
  objetivo: "",
  carga: "",
  movimientoId: "",
  movimientoTexto: "",
};

export function PesosPorCategoria({
  eventId,
  partId,
  movimientos,
  categorias,
  catalogo,
  iniciales,
  unidadInicial,
  /**
   * Peso declarado de la categoría, en KILOS CRUDOS, por
   * `${divisionId}|${nombreDelMovimiento}`. Se convierte acá con la unidad
   * VIGENTE de la grilla — no con la que la categoría declaró originalmente,
   * que puede ser otra.
   */
  sugerencias,
}: {
  eventId: string;
  partId: string;
  movimientos: MovimientoDeLaGrilla[];
  categorias: CategoriaDeLaGrilla[];
  /** El mismo catálogo que ofrece "Agregar movimiento", para elegir la variante. */
  catalogo: OpcionDeMovimiento[];
  iniciales: Record<string, ValorDeCelda>;
  unidadInicial: LoadUnit;
  sugerencias: Record<string, number>;
}) {
  const [celdas, setCeldas] = useState<Record<string, ValorDeCelda>>(iniciales);
  const [unidad, setUnidad] = useState<LoadUnit>(unidadInicial);
  const [pendiente, startTransition] = useTransition();
  const { exito, error: avisarError } = useNotificaciones();

  const clave = (divisionId: string, movimientoId: string) =>
    `${divisionId}|${movimientoId}`;

  const leer = (divisionId: string, movimientoId: string): ValorDeCelda =>
    celdas[clave(divisionId, movimientoId)] ?? CELDA_VACIA;

  const escribir = (
    divisionId: string,
    movimientoId: string,
    campo: keyof ValorDeCelda,
    valor: string,
  ) =>
    setCeldas((prev) => {
      const k = clave(divisionId, movimientoId);
      return { ...prev, [k]: { ...(prev[k] ?? CELDA_VACIA), [campo]: valor } };
    });

  // Qué celdas están mostrando el selector de variante EN VEZ del nombre. Es
  // puramente de interacción: no depende de si la celda ya tiene una
  // variante guardada, porque una variante ya elegida se muestra en su
  // estado natural (el nombre nuevo), no con el selector abierto.
  const [editando, setEditando] = useState<Set<string>>(() => new Set());

  const abrirEdicion = (k: string) => setEditando((prev) => new Set(prev).add(k));
  const cerrarEdicion = (k: string) =>
    setEditando((prev) => {
      const siguiente = new Set(prev);
      siguiente.delete(k);
      return siguiente;
    });

  /** Elegir una opción del selector: aplica y cierra, salvo "Otro", que
   *  todavía necesita el texto. */
  const elegirVariante = (divisionId: string, movimientoId: string, opcion: string) => {
    escribir(divisionId, movimientoId, "movimientoId", opcion);
    if (opcion === "otro") return; // sigue abierto: falta escribir el nombre
    escribir(divisionId, movimientoId, "movimientoTexto", "");
    cerrarEdicion(clave(divisionId, movimientoId));
  };

  /** Cierra el campo de texto libre. Vacío no es una variante: revierte al
   *  movimiento de la fila en vez de guardar un nombre en blanco. */
  const confirmarTexto = (divisionId: string, movimientoId: string) => {
    if (!leer(divisionId, movimientoId).movimientoTexto.trim()) {
      escribir(divisionId, movimientoId, "movimientoId", "");
    }
    cerrarEdicion(clave(divisionId, movimientoId));
  };

  const quitarVariante = (divisionId: string, movimientoId: string) => {
    escribir(divisionId, movimientoId, "movimientoId", "");
    escribir(divisionId, movimientoId, "movimientoTexto", "");
  };

  /**
   * Copia la tarjeta ENTERA desde otra categoría.
   *
   * Scaled arranca de Rx y solo se edita lo que cambia. Es puro cliente: no
   * escribe nada hasta que se aprieta Guardar.
   */
  const copiarDesde = (destino: string, origen: string) => {
    if (!origen) return;
    setCeldas((prev) => {
      const siguiente = { ...prev };
      for (const m of movimientos) {
        siguiente[clave(destino, m.id)] = prev[clave(origen, m.id)] ?? CELDA_VACIA;
      }
      return siguiente;
    });
  };

  const guardar = () => {
    const payload: CeldaDeSpec[] = [];

    for (const categoria of categorias) {
      for (const m of movimientos) {
        const { objetivo, carga, movimientoId, movimientoTexto } = leer(categoria.id, m.id);
        const objetivoLimpio = objetivo.trim();
        const cargaLimpia = carga.trim();
        const customName = movimientoId === "otro" ? movimientoTexto.trim() : "";
        const movementId = movimientoId && movimientoId !== "otro" ? movimientoId : "";

        if (movimientoId === "otro" && !customName) {
          avisarError(
            `Escribe el nombre del movimiento variante de ${m.nombre} en ${categoria.nombre}, o quítalo.`,
          );
          return;
        }

        if (!objetivoLimpio && !cargaLimpia && !movementId && !customName) continue;

        const numeros = objetivoDeCelda(objetivoLimpio);

        const kilos = cargaLimpia ? Number(cargaLimpia.replace(",", ".")) : null;
        if (kilos !== null && (!Number.isFinite(kilos) || kilos < 0)) {
          avisarError(`El peso de ${m.nombre} en ${categoria.nombre} no es válido.`);
          return;
        }

        payload.push({
          divisionId: categoria.id,
          partMovementId: m.id,
          objetivo: numeros.length > 0 ? numeros : null,
          // La conversión a kilos la hace el servidor con el mismo helper que
          // el resto de la app: acá solo viaja lo que se escribió y en qué
          // unidad.
          cargaKg: kilos,
          cargaUnidad: unidad,
          movementId: movementId || null,
          customName: customName || null,
        });
      }
    }

    startTransition(async () => {
      const r = await guardarSpecs(eventId, partId, payload);
      if (r.error) avisarError(r.error);
      else exito("Pesos guardados.");
    });
  };

  if (categorias.length === 0 || movimientos.length === 0) return null;

  const porCategoriaDeCatalogo = new Map<string, OpcionDeMovimiento[]>();
  for (const op of catalogo) {
    const lista = porCategoriaDeCatalogo.get(op.category) ?? [];
    lista.push(op);
    porCategoriaDeCatalogo.set(op.category, lista);
  }
  const nombreDeCatalogo = new Map(catalogo.map((op) => [op.id, op.name]));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">Pesos y cantidades por categoría</h3>
          <p className="mt-0.5 text-sm text-neutral-500">
            Vacío = lo mismo que la prueba. El verde es el valor base.
          </p>
        </div>

        {/* La unidad es de TODA la pantalla, no de cada tarjeta: todos los
            pesos de un WOD se programan en la misma. Un selector por tarjeta
            serían diez desplegables con la misma respuesta. */}
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">Pesos en</span>
          <Selector
            value={unidad}
            onChange={(e) => setUnidad(e.target.value as LoadUnit)}
            className="w-20 py-2 text-sm"
          >
            <option value="kg">kg</option>
            <option value="lb">lb</option>
          </Selector>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categorias.map((categoria) => (
          <TarjetaDeCategoria
            key={categoria.id}
            categoria={categoria}
            otrasCategorias={categorias.filter((c) => c.id !== categoria.id)}
            movimientos={movimientos}
            catalogoPorTipo={porCategoriaDeCatalogo}
            nombreDeCatalogo={nombreDeCatalogo}
            unidad={unidad}
            sugerencias={sugerencias}
            leer={leer}
            escribir={escribir}
            editando={editando}
            abrirEdicion={abrirEdicion}
            cerrarEdicion={cerrarEdicion}
            elegirVariante={elegirVariante}
            confirmarTexto={confirmarTexto}
            quitarVariante={quitarVariante}
            copiarDesde={copiarDesde}
            clave={clave}
          />
        ))}
      </div>

      <div>
        <Boton compacto onClick={guardar} cargando={pendiente} textoCargando="Guardando…">
          Guardar pesos
        </Boton>
      </div>
    </section>
  );
}

/**
 * Todo lo que corre UNA categoría: sus movimientos, sus pesos y sus
 * variantes, en una sola tarjeta.
 *
 * Recibe `leer`/`escribir` del padre en vez de manejar su propio estado: el
 * dato vive arriba (una sola fuente para armar el payload de "Guardar"), la
 * tarjeta solo lo pinta y lo edita.
 */
function TarjetaDeCategoria({
  categoria,
  otrasCategorias,
  movimientos,
  catalogoPorTipo,
  nombreDeCatalogo,
  unidad,
  sugerencias,
  leer,
  escribir,
  editando,
  abrirEdicion,
  cerrarEdicion,
  elegirVariante,
  confirmarTexto,
  quitarVariante,
  copiarDesde,
  clave,
}: {
  categoria: CategoriaDeLaGrilla;
  otrasCategorias: CategoriaDeLaGrilla[];
  movimientos: MovimientoDeLaGrilla[];
  catalogoPorTipo: Map<string, OpcionDeMovimiento[]>;
  nombreDeCatalogo: Map<string, string>;
  unidad: LoadUnit;
  sugerencias: Record<string, number>;
  leer: (divisionId: string, movimientoId: string) => ValorDeCelda;
  escribir: (
    divisionId: string,
    movimientoId: string,
    campo: keyof ValorDeCelda,
    valor: string,
  ) => void;
  editando: Set<string>;
  abrirEdicion: (k: string) => void;
  cerrarEdicion: (k: string) => void;
  elegirVariante: (divisionId: string, movimientoId: string, opcion: string) => void;
  confirmarTexto: (divisionId: string, movimientoId: string) => void;
  quitarVariante: (divisionId: string, movimientoId: string) => void;
  copiarDesde: (destino: string, origen: string) => void;
  clave: (divisionId: string, movimientoId: string) => string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{categoria.nombre}</h4>
        {otrasCategorias.length > 0 && (
          <Selector
            value=""
            onChange={(e) => {
              copiarDesde(categoria.id, e.target.value);
              e.currentTarget.value = "";
            }}
            className="w-36 py-1 text-xs"
          >
            <option value="">Copiar de…</option>
            {otrasCategorias.map((otra) => (
              <option key={otra.id} value={otra.id}>
                {otra.nombre}
              </option>
            ))}
          </Selector>
        )}
      </div>

      <ul className="flex flex-col gap-2.5">
        {movimientos.map((m) => {
          const valor = leer(categoria.id, m.id);
          const k = clave(categoria.id, m.id);
          const editandoEsta = editando.has(k);
          const tieneVariante = valor.movimientoId !== "";
          const nombreMostrado =
            valor.movimientoId === "otro"
              ? valor.movimientoTexto || m.nombre
              : tieneVariante
                ? (nombreDeCatalogo.get(valor.movimientoId) ?? m.nombre)
                : m.nombre;
          const kgSugerido = sugerencias[`${categoria.id}|${m.nombre}`];
          // Convertido con la unidad VIGENTE de la pantalla, no con la que la
          // categoría declaró: son cosas distintas y pueden no coincidir.
          const sugerido =
            kgSugerido !== undefined ? String(desdeKilos(kgSugerido, unidad)) : undefined;

          return (
            <li
              key={m.id}
              className="rounded-xl border border-neutral-900 bg-neutral-950/50 p-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  {editandoEsta ? (
                    valor.movimientoId === "otro" ? (
                      <input
                        autoFocus
                        value={valor.movimientoTexto}
                        onChange={(e) =>
                          escribir(categoria.id, m.id, "movimientoTexto", e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        onBlur={() => confirmarTexto(categoria.id, m.id)}
                        placeholder="Nombre del movimiento"
                        className={`${campoAncho} text-sm`}
                        aria-label={`Nombre de la variante de ${m.nombre} en ${categoria.nombre}`}
                      />
                    ) : (
                      <>
                        <Selector
                          autoFocus
                          value={valor.movimientoId}
                          onChange={(e) =>
                            elegirVariante(categoria.id, m.id, e.target.value)
                          }
                          className="flex-1 py-1 text-sm"
                          aria-label={`Variante de ${m.nombre} en ${categoria.nombre}`}
                        >
                          <option value="">{m.nombre} (sin variante)</option>
                          {[...catalogoPorTipo.entries()].map(([cat, lista]) => (
                            <optgroup key={cat} label={CATEGORIA[cat] ?? cat}>
                              {lista.map((op) => (
                                <option key={op.id} value={op.id}>
                                  {op.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                          <option value="otro">Otro (escribir)</option>
                        </Selector>
                        <button
                          type="button"
                          onClick={() => cerrarEdicion(k)}
                          className="shrink-0 px-0.5 text-neutral-600 transition-colors hover:text-neutral-400"
                          title="Cancelar"
                        >
                          ✕
                        </button>
                      </>
                    )
                  ) : (
                    <>
                      <span
                        className="truncate text-sm font-medium"
                        title={tieneVariante ? `Movimiento de la prueba: ${m.nombre}` : undefined}
                      >
                        {nombreMostrado}
                      </span>
                      <button
                        type="button"
                        onClick={() => abrirEdicion(k)}
                        className="shrink-0 text-xs font-medium text-lime-400 transition-colors hover:text-lime-300"
                      >
                        Variar
                      </button>
                      {tieneVariante && (
                        <button
                          type="button"
                          onClick={() => quitarVariante(categoria.id, m.id)}
                          className="shrink-0 text-neutral-600 transition-colors hover:text-red-400"
                          title="Volver al movimiento de la prueba"
                        >
                          ✕
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* El valor base, resaltado: es la referencia contra la que
                    esta categoría se está desviando (o no). */}
                <span className="shrink-0 rounded-full bg-lime-400/10 px-2 py-0.5 text-xs font-medium text-lime-300">
                  {m.objetivoBase.join("-")}
                  {m.cargaBaseKg !== null &&
                    ` · ${desdeKilos(m.cargaBaseKg, m.cargaBaseUnidad)} ${m.cargaBaseUnidad}`}
                </span>
              </div>

              <div className="mt-2 flex gap-1.5">
                <input
                  value={valor.objetivo}
                  onChange={(e) => escribir(categoria.id, m.id, "objetivo", e.target.value)}
                  placeholder={m.objetivoBase.join("-")}
                  className={campo}
                  aria-label={`Objetivo de ${m.nombre} en ${categoria.nombre}`}
                />
                {m.admiteCarga && (
                  <input
                    value={valor.carga}
                    onChange={(e) => escribir(categoria.id, m.id, "carga", e.target.value)}
                    inputMode="decimal"
                    /* La sugerencia sale del estándar declarado de la
                       categoría: si Elite ya dice "Thruster 43 kg", ese es el
                       placeholder. Es SUGERENCIA y no valor: el estándar y lo
                       que pide un WOD concreto pueden diferir legítimamente. */
                    placeholder={
                      sugerido ??
                      (m.cargaBaseKg !== null
                        ? String(desdeKilos(m.cargaBaseKg, unidad))
                        : "—")
                    }
                    className={campo}
                    aria-label={`Peso de ${m.nombre} en ${categoria.nombre}`}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Dentro de una tarjeta hay más ancho disponible que en la vieja grilla con
// columna fija: los campos se reparten el espacio (`flex-1`) en vez de tener
// un ancho fijo pensado para caber muchas columnas apretadas.
const campo =
  "min-w-0 flex-1 rounded-lg border border-neutral-800 bg-transparent px-2 py-1.5 text-sm outline-none transition-colors focus:border-lime-400";
const campoAncho =
  "w-full rounded-lg border border-neutral-800 bg-transparent px-2 py-1.5 text-sm outline-none transition-colors focus:border-lime-400";
