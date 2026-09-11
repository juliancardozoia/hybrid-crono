"use client";

import { useState, useTransition } from "react";
import { guardarSpecs } from "../actions";
import { objetivoDeCelda, type CeldaDeSpec } from "../lib/pesos";
import { Boton } from "@/shared/components/Boton";
import { Selector } from "@/shared/components/Selector";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { desdeKilos } from "@/shared/unidades/carga";
import type { LoadUnit } from "@/lib/supabase/types";

/**
 * Los pesos y las cantidades de cada categoría, en UNA grilla.
 *
 * `division_movement_specs` es la tabla que hace Rx contra Scaled. La leen el
 * juez y el recálculo del servidor, la muestra la ficha pública — y no tenía
 * NINGÚN camino de escritura: todas las categorías juzgaban con el mismo peso.
 *
 * UNA FILA POR MOVIMIENTO, UNA COLUMNA POR CATEGORÍA, y un solo "Guardar
 * pesos" al pie. Un formulario por categoría serían seis botones idénticos sin
 * nada que distinga cuál está pendiente — el mismo problema que ya llevó a
 * juntar los precios de las categorías en un solo envío.
 *
 * EL VALOR BASE VA DE `placeholder`, NUNCA DE `value`. Vacío significa
 * "heredar", y borrar el campo borra el ajuste. Si el base viniera cargado como
 * valor, abrir la pantalla y guardar convertiría todas las herencias en copias
 * fijas, y cambiar el peso base después ya no se propagaría a nadie.
 *
 * NO va dentro de un `<form action={...}>`: React 19 llama al `form.reset()`
 * nativo al terminar y esta grilla tiene que CONSERVAR lo recién guardado.
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
}

export function PesosPorCategoria({
  eventId,
  partId,
  movimientos,
  categorias,
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
    celdas[clave(divisionId, movimientoId)] ?? { objetivo: "", carga: "" };

  const escribir = (
    divisionId: string,
    movimientoId: string,
    campo: keyof ValorDeCelda,
    valor: string,
  ) =>
    setCeldas((prev) => {
      const k = clave(divisionId, movimientoId);
      return { ...prev, [k]: { ...(prev[k] ?? { objetivo: "", carga: "" }), [campo]: valor } };
    });

  /**
   * Copia una columna entera desde otra categoría.
   *
   * Scaled arranca de Rx y solo se edita lo que cambia. Es puro cliente: no
   * escribe nada hasta que se aprieta Guardar.
   */
  const copiarDesde = (destino: string, origen: string) => {
    if (!origen) return;
    setCeldas((prev) => {
      const siguiente = { ...prev };
      for (const m of movimientos) {
        siguiente[clave(destino, m.id)] = prev[clave(origen, m.id)] ?? {
          objetivo: "",
          carga: "",
        };
      }
      return siguiente;
    });
  };

  const guardar = () => {
    const payload: CeldaDeSpec[] = [];

    for (const categoria of categorias) {
      for (const m of movimientos) {
        const { objetivo, carga } = leer(categoria.id, m.id);
        const objetivoLimpio = objetivo.trim();
        const cargaLimpia = carga.trim();
        if (!objetivoLimpio && !cargaLimpia) continue;

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

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold">Pesos y cantidades por categoría</h3>
          <p className="mt-0.5 text-sm text-neutral-500">
            Vacío = lo mismo que la prueba. El gris es el valor base.
          </p>
        </div>

        {/* La unidad es de la GRILLA, no de cada celda: todos los pesos de un
            WOD se programan en la misma. Un selector por celda serían treinta
            desplegables con la misma respuesta. */}
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-neutral-950 px-3 py-2 text-left font-medium text-neutral-400">
                Movimiento
              </th>
              {categorias.map((c) => (
                <th key={c.id} className="px-3 py-2 text-left font-medium">
                  <span className="block">{c.nombre}</span>
                  {categorias.length > 1 && (
                    <Selector
                      value=""
                      onChange={(e) => {
                        copiarDesde(c.id, e.target.value);
                        e.currentTarget.value = "";
                      }}
                      className="mt-1 w-full py-1 text-xs font-normal"
                    >
                      <option value="">Copiar de…</option>
                      {categorias
                        .filter((otra) => otra.id !== c.id)
                        .map((otra) => (
                          <option key={otra.id} value={otra.id}>
                            {otra.nombre}
                          </option>
                        ))}
                    </Selector>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-t border-neutral-900">
                <td className="sticky left-0 z-10 bg-neutral-950 px-3 py-2 align-top">
                  <span className="block font-medium">{m.nombre}</span>
                  <span className="block text-xs text-neutral-600">
                    {m.objetivoBase.join("-")}
                    {m.cargaBaseKg !== null &&
                      ` · ${desdeKilos(m.cargaBaseKg, m.cargaBaseUnidad)} ${m.cargaBaseUnidad}`}
                  </span>
                </td>

                {categorias.map((c) => {
                  const valor = leer(c.id, m.id);
                  const kgSugerido = sugerencias[`${c.id}|${m.nombre}`];
                  // Convertido con la unidad VIGENTE de la grilla, no con la
                  // que la categoría declaró: son cosas distintas y pueden no
                  // coincidir.
                  const sugerido =
                    kgSugerido !== undefined ? String(desdeKilos(kgSugerido, unidad)) : undefined;
                  return (
                    <td key={c.id} className="px-3 py-2 align-top">
                      <div className="flex gap-1.5">
                        <input
                          value={valor.objetivo}
                          onChange={(e) =>
                            escribir(c.id, m.id, "objetivo", e.target.value)
                          }
                          placeholder={m.objetivoBase.join("-")}
                          className={campo}
                          aria-label={`Objetivo de ${m.nombre} en ${c.nombre}`}
                        />
                        {m.admiteCarga && (
                          <input
                            value={valor.carga}
                            onChange={(e) =>
                              escribir(c.id, m.id, "carga", e.target.value)
                            }
                            inputMode="decimal"
                            /* La sugerencia sale del estándar declarado de la
                               categoría: si Elite ya dice "Thruster 43 kg", ese
                               es el placeholder. Es SUGERENCIA y no valor: el
                               estándar y lo que pide un WOD concreto pueden
                               diferir legítimamente. */
                            placeholder={
                              sugerido ??
                              (m.cargaBaseKg !== null
                                ? String(desdeKilos(m.cargaBaseKg, unidad))
                                : "—")
                            }
                            className={campo}
                            aria-label={`Peso de ${m.nombre} en ${c.nombre}`}
                          />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Boton compacto onClick={guardar} cargando={pendiente} textoCargando="Guardando…">
        Guardar pesos
      </Boton>
    </section>
  );
}

const campo =
  "w-20 rounded-lg border border-neutral-800 bg-transparent px-2 py-1.5 text-sm outline-none transition-colors focus:border-lime-400";
