"use client";

import { useState } from "react";
import { Icono } from "./Icono";

/**
 * Un icono que copia un dato al portapapeles — email, teléfono, lo que sea.
 *
 * NO MUESTRA EL DATO, SOLO LO COPIA. Es para la grilla de atletas: mostrar el
 * correo y el teléfono de cientos de personas en texto plano en una tabla es
 * exponer datos personales sin necesidad — quien administra la competencia
 * casi siempre lo que quiere es PEGARLO en otro lado (un mensaje, un mail
 * masivo), no leerlo ahí mismo.
 */
export function BotonCopiar({ valor, titulo }: { valor: string; titulo: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <button
      type="button"
      title={copiado ? "¡Copiado!" : titulo}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1500);
        } catch {
          // Sin permiso de portapapeles: no hay mucho mas que ofrecer aca.
        }
      }}
      className={`rounded-lg p-1.5 transition-colors ${
        copiado
          ? "text-lime-400"
          : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
      }`}
    >
      <Icono nombre={copiado ? "tilde" : "copiar"} className="h-3.5 w-3.5" />
    </button>
  );
}
