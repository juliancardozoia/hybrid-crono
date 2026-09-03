"use client";

import { useId, useState } from "react";

/**
 * Campo de contraseña con el ojo para verla.
 *
 * No es adorno: en un celular, escribir doce caracteres a ciegas con el teclado
 * tapando media pantalla es la causa mas comun de "no me deja entrar". El boton
 * dice en texto que hace, porque un icono de ojo tachado no le dice nada a un
 * lector de pantalla.
 *
 * El `autoComplete` correcto importa mas de lo que parece: con
 * `current-password` el navegador ofrece la guardada, y con `new-password`
 * ofrece generar una fuerte. Ponerle `off` a un campo de clave, que es lo que
 * suele hacerse "por seguridad", empeora las contraseñas de todo el mundo.
 */
export function CampoDeClave({
  name = "password",
  label,
  ver,
  ocultar,
  autoComplete,
  minLength,
  pista,
}: {
  name?: string;
  label: string;
  ver: string;
  ocultar: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  pista?: string;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          className="w-full rounded-xl border border-neutral-700 bg-transparent px-4 py-3 pr-16 outline-none transition-colors focus:border-lime-400"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 hover:text-neutral-200"
        >
          {visible ? ocultar : ver}
        </button>
      </div>
      {pista && <p className="text-xs text-neutral-600">{pista}</p>}
    </div>
  );
}
