"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { guardarPerfil, type FormState } from "../actions";
import { PAISES } from "@/shared/utils/paises";
import { etiquetaSubdivision } from "@/shared/utils/subdivision";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { Selector } from "@/shared/components/Selector";
import { useNotificaciones, useToastDeEstado } from "@/shared/components/Notificaciones";
import type { Perfil } from "../queries";

const initial: FormState = { error: null, message: null };

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none transition-colors focus:border-lime-400";
const selector = "w-full py-3";

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
 *
 * PERO el `key` del formulario es necesario igual. `defaultValue` solo fija
 * el valor de un input UNCONTROLADO al MONTARLO — un input ya montado no
 * vuelve a leer `defaultValue` aunque el prop `perfil` cambie con datos
 * frescos del servidor tras guardar. Sin el `key`, React 19 hace
 * `form.reset()` de vuelta al `defaultValue` que el input tenia en el
 * momento del reset (el VIEJO, porque el nuevo `perfil` todavia no llego o
 * ya no se vuelve a aplicar), y el formulario parecia "no guardar" hasta que
 * se refrescaba la pagina a mano. Un `key` derivado de los propios campos
 * fuerza a React a tirar el DOM viejo y montar uno nuevo con los valores
 * frescos apenas el server-component padre los trae.
 */
export function FormularioDePerfil({ perfil }: { perfil: Perfil }) {
  const [state, formAction] = useActionState(guardarPerfil, initial);
  useToastDeEstado(state);

  const { exito } = useNotificaciones();
  const anterior = useRef<FormState | null>(null);
  useEffect(() => {
    if (state !== anterior.current) {
      if (state.message) exito(state.message);
      anterior.current = state;
    }
  }, [state, exito]);

  const [pais, setPais] = useState(perfil.country ?? "");

  const key = [
    perfil.fullName,
    perfil.phoneCountry,
    perfil.phone,
    perfil.birthDate,
    perfil.country,
    perfil.city,
    perfil.instagram,
    perfil.documentId,
    perfil.stateProvince,
    perfil.box,
  ].join("|");

  return (
    <form key={key} action={formAction} className="flex flex-col gap-5">
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
          <Selector
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
          </Selector>
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
          <Selector
            name="country"
            value={pais}
            onChange={(e) => setPais(e.target.value)}
            className={selector}
          >
            <option value="">—</option>
            {PAISES.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre}
              </option>
            ))}
          </Selector>
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
          <span className="text-sm font-medium">{etiquetaSubdivision(pais)}</span>
          <input
            name="stateProvince"
            defaultValue={perfil.stateProvince ?? ""}
            className={campo}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Documento (DNI)</span>
          <input
            name="documentId"
            defaultValue={perfil.documentId ?? ""}
            className={campo}
          />
          <span className="text-xs text-neutral-600">
            Único por cuenta: no puede repetirse en otro perfil de Scora.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Box (opcional)</span>
          <input
            name="box"
            defaultValue={perfil.box ?? ""}
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
