"use client";

import { useActionState } from "react";
import { guardarPerfil, type FormState } from "../actions";
import { PAISES } from "@/shared/utils/paises";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { Perfil } from "../queries";

const initial: FormState = { error: null, message: null };

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none transition-colors focus:border-lime-400";
const selector =
  "w-full appearance-none rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none transition-colors focus:border-lime-400";

/**
 * Los datos del competidor.
 *
 * SOLO EL NOMBRE ES OBLIGATORIO. El registro pide correo y clave y nada mas —un
 * formulario de doce campos en la puerta espanta a la mitad— y el resto se
 * completa aqui cuando hace falta. El telefono, por ejemplo, solo importa el dia
 * que el organizador tenga que avisar de un cambio de horario.
 *
 * El correo se muestra pero NO se edita: lo gobierna el sistema de
 * autenticacion, y cambiarlo aqui dejaria el perfil apuntando a una cuenta con
 * la que ya no se puede entrar.
 *
 * Va dentro de un `<form action={...}>` a proposito, al reves que la grilla de
 * scores: aqui no hay nada que conservar tras guardar —los valores vuelven del
 * servidor ya actualizados— asi que el reset de React 19 no molesta.
 */
export function FormularioDePerfil({ perfil }: { perfil: Perfil }) {
  const [state, formAction] = useActionState(guardarPerfil, initial);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium">Nombre completo</span>
          <input
            name="fullName"
            defaultValue={perfil.fullName ?? ""}
            required
            autoComplete="name"
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium">Email</span>
          <input
            value={perfil.email}
            readOnly
            disabled
            className={`${campo} cursor-not-allowed text-neutral-500`}
          />
          <span className="text-xs text-neutral-600">
            Es con el que entras. Para cambiarlo, escríbenos.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Prefijo</span>
          <select
            name="phoneCountry"
            defaultValue={perfil.phoneCountry ?? ""}
            className={selector}
          >
            <option value="">—</option>
            {PAISES.map((p) => (
              <option key={p.codigo} value={p.prefijo}>
                {p.prefijo} {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Teléfono</span>
          <input
            name="phone"
            type="tel"
            defaultValue={perfil.phone ?? ""}
            autoComplete="tel-national"
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Fecha de nacimiento</span>
          <input
            name="birthDate"
            type="date"
            defaultValue={perfil.birthDate ?? ""}
            className={campo}
          />
          <span className="text-xs text-neutral-600">
            Algunas categorías tienen rango de edad.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">País</span>
          <select
            name="country"
            defaultValue={perfil.country ?? ""}
            className={selector}
          >
            <option value="">—</option>
            {PAISES.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Ciudad</span>
          <input
            name="city"
            defaultValue={perfil.city ?? ""}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Instagram</span>
          <input
            name="instagram"
            defaultValue={perfil.instagram ?? ""}
            placeholder="tuusuario"
            className={campo}
          />
        </label>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          role="status"
          className="rounded-xl border border-lime-500/40 bg-lime-500/10 p-3 text-sm text-lime-300"
        >
          {state.message}
        </p>
      )}

      <BotonDeEnvio
        pendienteTexto="Guardando…"
        mensajeDeCarga="Guardando tu perfil…"
        className="w-fit rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
      >
        Guardar cambios
      </BotonDeEnvio>
    </form>
  );
}
