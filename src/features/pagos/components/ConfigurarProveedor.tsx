"use client";

import { useActionState } from "react";
import { guardarProveedor, type FormState } from "../actions";
import { ADAPTADORES } from "../adapters";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { PaymentProvider } from "@/lib/supabase/types";

/**
 * Configuracion de un medio de cobro.
 *
 * El campo del secreto se muestra SIEMPRE vacio, aunque ya haya credencial
 * guardada: el texto cifrado no sale de la base ni para su dueno. Dejarlo vacio
 * al guardar significa "no lo toques" — si significara "borralo", editar el
 * numero de cuenta borraria la credencial sin avisar.
 *
 * EL ADAPTADOR SE IMPORTA, NO SE RECIBE POR PROP. Recibirlo entero rompia la
 * pagina entera con "Functions cannot be passed directly to Client Components":
 * `Adaptador` tiene el metodo `instrucciones()`, y un componente de servidor solo
 * puede pasar valores serializables. Es el mismo patron que ya usaba
 * `BloqueDePago`, que importa `ADAPTADORES` y busca el suyo por `provider`.
 */

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-lime-400";

export function ConfigurarProveedor({
  orgId,
  provider,
  actual,
}: {
  orgId: string;
  provider: PaymentProvider;
  actual: {
    label: string | null;
    publicConfig: Record<string, string>;
    active: boolean;
    tieneSecreto: boolean;
  } | null;
}) {
  // Se busca aquí, en el cliente. El tipo del prop era un `Pick<>` sin
  // `instrucciones`, pero un `Pick` NO quita nada en runtime: el objeto que
  // llegaba seguía teniendo el método y Next rechazaba la página entera.
  const adaptador = ADAPTADORES[provider];

  const [state, formAction] = useActionState(guardarProveedor, {
    error: null,
  } as FormState);

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-neutral-800 p-5"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="provider" value={provider} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{adaptador.nombre}</h3>
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
              actual?.tieneSecreto
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

      {state.error && (
        <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div className="mt-4">
        <BotonDeEnvio
          pendienteTexto="Guardando…"
          mensajeDeCarga="Guardando el medio de cobro…"
          className="rounded-xl bg-lime-400 px-5 py-2.5 font-bold text-lime-950 hover:bg-lime-300 disabled:opacity-60"
        >
          Guardar
        </BotonDeEnvio>
      </div>
    </form>
  );
}
