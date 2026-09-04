"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { guardarPasoInscripcion } from "../actions";
import { ADAPTADORES, MEDIOS_OFRECIDOS } from "@/features/pagos/adapters";
import { MONEDAS } from "@/features/pagos/lib/monedas";
import { CodigosDeDescuento } from "@/features/pagos/components/CodigosDeDescuento";
import { pasoAnterior, pasoSiguiente } from "@/features/events/lib/asistente";
import { useCargaMientras } from "@/shared/components/Carga";
import { Selector } from "@/shared/components/Selector";
import type {
  DiscountCodeRow,
  DivisionRegistration,
  PaymentProvider,
} from "@/lib/supabase/types";

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400";
const selector = "w-64 py-2.5 text-sm";

interface ProveedorConfigurado {
  provider: PaymentProvider;
  label: string | null;
  publicConfig: Record<string, string>;
  active: boolean;
}

/**
 * Moneda, medio de cobro y precio por categoria, en UN solo formulario.
 *
 * Es el paso "Inscripcion" del asistente: no tiene ningun boton "Guardar"
 * propio. El boton "Continuar" de abajo ES el submit de este formulario —
 * `guardarPasoInscripcion` hace las tres escrituras (moneda, medio de cobro,
 * precios) y recien despues redirige al resumen. Si algo no es valido, la
 * accion vuelve con un error y nada se pierde: los campos siguen con lo que se
 * habia escrito, porque no hubo navegacion.
 *
 * Los codigos de descuento quedan FUERA de este formulario: crear uno es
 * agregar un item a una lista, no un campo que "continuar" tenga que guardar,
 * asi que `CodigosDeDescuento` conserva su propio boton "Crear código" — igual
 * que "Nueva categoría" en `/divisiones` o subir un documento en el paso
 * anterior, que tampoco esperan al botón de avanzar.
 */
export function FormularioInscripcionAsistente({
  eventId,
  orgId,
  moneda,
  configurados,
  divisiones,
  config,
  codigos,
}: {
  eventId: string;
  orgId: string | null;
  moneda: string;
  configurados: ProveedorConfigurado[];
  divisiones: Array<{ id: string; name: string }>;
  config: Map<string, DivisionRegistration>;
  codigos: DiscountCodeRow[];
}) {
  const [state, formAction, pending] = useActionState(guardarPasoInscripcion, {
    error: null,
  } as { error: string | null });
  useCargaMientras(pending, "Guardando la inscripción…");

  const porProveedor = new Map(configurados.map((c) => [c.provider, c]));
  const activos = configurados.filter((c) => c.active);
  const [abierto, setAbierto] = useState<PaymentProvider>(
    activos[0]?.provider ?? MEDIOS_OFRECIDOS[0],
  );

  const anterior = pasoAnterior("inscripcion");
  const siguiente = pasoSiguiente("inscripcion");
  const actual = porProveedor.get(abierto);
  const adaptador = ADAPTADORES[abierto];

  return (
    <div className="flex flex-col gap-8">
      <form
        id="paso-inscripcion"
        action={formAction}
        className="flex flex-col gap-8"
      >
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="orgId" value={orgId ?? ""} />
        <input type="hidden" name="provider" value={abierto} />
        <input
          type="hidden"
          name="divisionIds"
          value={divisiones.map((d) => d.id).join(",")}
        />

        {/* --- Moneda -------------------------------------------------- */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-neutral-400 uppercase">
            Moneda de la competencia
          </h3>
          <Selector name="currency" defaultValue={moneda} className={selector}>
            {MONEDAS.map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.codigo} — {m.nombre}
              </option>
            ))}
          </Selector>
          <p className="text-xs text-neutral-600">
            Aplica a todos los medios de cobro y a todas las categorías.
          </p>
        </section>

        {/* --- Cómo se cobra --------------------------------------------- */}
        <section className="flex flex-col gap-4 border-t border-neutral-800 pt-8">
          <div>
            <h3 className="text-sm font-semibold text-neutral-400 uppercase">
              Cómo se cobra
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-neutral-500">
              El dinero va{" "}
              <span className="text-neutral-300">directo a tus cuentas</span>:
              la plataforma no lo custodia. Estas credenciales son de tu
              organización y valen para todas tus competencias.
            </p>
          </div>

          {activos.length === 0 && (
            <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
              Todavía no hay ningún medio de cobro activo. Sin uno, las
              categorías con precio no se pueden pagar y la inscripción queda
              esperando para siempre.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {MEDIOS_OFRECIDOS.map((provider) => {
              const c = porProveedor.get(provider);
              const elegido = provider === abierto;
              return (
                <button
                  key={provider}
                  type="button"
                  onClick={() => setAbierto(provider)}
                  aria-pressed={elegido}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
                    elegido
                      ? "border-lime-400 bg-lime-400/10 text-lime-300"
                      : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                  }`}
                >
                  {ADAPTADORES[provider].nombre}
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${c?.active ? "bg-lime-400" : "bg-neutral-700"}`}
                    aria-label={c?.active ? "activo" : "sin configurar"}
                  />
                </button>
              );
            })}
          </div>

          {/* `key={abierto}` remonta la seccion al cambiar de medio: sin eso,
              los campos de la pasarela anterior quedarian escritos en el DOM
              aunque ya no correspondan a la que quedo seleccionada. */}
          <div
            key={abierto}
            className="rounded-2xl border border-neutral-800 p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="font-semibold">{adaptador.nombre}</h4>
              <label className="flex items-center gap-2 text-sm text-neutral-400">
                <input
                  type="checkbox"
                  name="activo"
                  defaultChecked={actual?.active ?? false}
                  className="accent-lime-400"
                />
                Ofrecerlo a los atletas
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {adaptador.camposPublicos.map((c) => (
                <label key={c.key} className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-400">{c.label}</span>
                  <input
                    name={`campo-${c.key}`}
                    defaultValue={actual?.publicConfig?.[c.key] ?? ""}
                    className={campo}
                  />
                  {c.ayuda && (
                    <span className="text-xs text-neutral-600">{c.ayuda}</span>
                  )}
                </label>
              ))}
            </div>

            {adaptador.campoSecreto && (
              <label className="mt-3 flex flex-col gap-1">
                <span className="text-xs text-neutral-400">
                  {adaptador.campoSecreto.label}
                </span>
                <input
                  name="secreto"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    adaptador.requiereSecreto
                      ? "Ya hay una guardada — dejalo vacío para no tocarla"
                      : ""
                  }
                  className={campo}
                />
                <span className="text-xs text-neutral-600">
                  {adaptador.campoSecreto.ayuda} Se guarda cifrada y no se puede
                  volver a leer.
                </span>
              </label>
            )}
          </div>
        </section>

        {/* --- Precio por categoría --------------------------------------- */}
        {divisiones.length > 0 && (
          <section className="flex flex-col gap-4 border-t border-neutral-800 pt-8">
            <div>
              <h3 className="text-sm font-semibold text-neutral-400 uppercase">
                Precio por categoría
              </h3>
              <p className="mt-1 text-sm text-neutral-500">
                Una categoría sin precio se confirma sola al enviarse: es lo que
                hace que una competencia interna funcione de punta a punta sin
                cobrar nada.
              </p>
            </div>

            <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
              {divisiones.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span className="min-w-40 flex-1 font-medium">{d.name}</span>
                  <label className="flex items-center gap-2">
                    <span className="text-sm text-neutral-500">{moneda}</span>
                    <input
                      name={`precio_${d.id}`}
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0 = sin costo"
                      defaultValue={
                        config.get(d.id)?.price_cents != null
                          ? config.get(d.id)!.price_cents! / 100
                          : ""
                      }
                      className="w-40 rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {state.error && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {state.error}
          </p>
        )}
      </form>

      {/* Fuera del formulario grande: crear un codigo es una accion propia,
          no un campo de este paso. */}
      <div className="border-t border-neutral-800 pt-8">
        <CodigosDeDescuento
          eventId={eventId}
          codigos={codigos}
          divisiones={divisiones.map((d) => ({ id: d.id, name: d.name }))}
        />
      </div>

      <nav className="flex items-center justify-between gap-3 border-t border-neutral-800 pt-6">
        {anterior ? (
          <Link
            href={`/panel/asistente/${eventId}/${anterior.slug}`}
            className="rounded-xl border border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-300 transition-colors hover:border-neutral-700 hover:bg-neutral-900"
          >
            ← {anterior.titulo}
          </Link>
        ) : (
          <span />
        )}

        {/* `form="paso-inscripcion"` lo asocia al formulario grande aunque
            este fuera de el en el DOM — es exactamente lo que el atributo
            existe para resolver, y evita anidar los codigos de descuento
            dentro de un `<form>` que ya tiene el suyo. */}
        <button
          type="submit"
          form="paso-inscripcion"
          disabled={pending}
          className="rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
        >
          {pending ? "Guardando…" : siguiente ? "Continuar →" : "Finalizar"}
        </button>
      </nav>
    </div>
  );
}
