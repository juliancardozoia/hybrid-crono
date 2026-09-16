"use client";

import { useActionState } from "react";
import { guardarProveedor, type FormState } from "../actions";
import { ADAPTADORES } from "../adapters";
import { claseDeBoton } from "@/shared/components/Boton";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import { Field } from "@/shared/components/SimpleForm";
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

      <h3 className="font-semibold">{adaptador.nombre}</h3>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {adaptador.camposPublicos.map((c) => (
          <Field
            key={c.key}
            label={c.label}
            name={`campo-${c.key}`}
            defaultValue={actual?.publicConfig?.[c.key] ?? ""}
            ayuda={c.ayuda}
          />
        ))}
      </div>

      {adaptador.campoSecreto && (
        <div className="mt-3">
          <Field
            label={adaptador.campoSecreto.label}
            name="secreto"
            type="password"
            autoComplete="off"
            placeholder={
              actual?.tieneSecreto
                ? "Ya hay una guardada — dejalo vacío para no tocarla"
                : ""
            }
            ayuda={`${adaptador.campoSecreto.ayuda} Se guarda cifrada y no se puede volver a leer.`}
          />
        </div>
      )}

      {adaptador.campoSecretoExtra && (
        <div className="mt-3">
          <Field
            label={adaptador.campoSecretoExtra.label}
            name="secretoExtra"
            type="password"
            autoComplete="off"
            placeholder={
              actual?.tieneSecreto
                ? "Ya hay uno guardado — dejalo vacío para no tocarlo"
                : ""
            }
            ayuda={`${adaptador.campoSecretoExtra.ayuda} Se guarda cifrado y no se puede volver a leer.`}
          />
        </div>
      )}

      {state.error && (
        <MensajeDeError className="mt-3">{state.error}</MensajeDeError>
      )}

      {/* Al lado del boton de guardar, no arriba junto al titulo: ahi
          quedaba fuera de la vista al bajar a llenar los campos, y se
          perdia de vista que hay que tildarlo para que de verdad ofrezca
          este medio. */}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <BotonDeEnvio
          pendienteTexto="Guardando…"
          mensajeDeCarga="Guardando el medio de cobro…"
          className={claseDeBoton({ variante: "primary", compacto: true })}
        >
          Guardar
        </BotonDeEnvio>

        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input
            type="checkbox"
            name="activo"
            defaultChecked={actual?.active ?? false}
            className="h-4 w-4 accent-lime-400"
          />
          Ofrecerlo a los atletas
        </label>
      </div>
    </form>
  );
}
