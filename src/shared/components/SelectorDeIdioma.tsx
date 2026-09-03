"use client";

import { useTransition } from "react";
import { IDIOMAS, type Idioma } from "@/shared/i18n/idiomas";

/**
 * El cambio de idioma.
 *
 * Tres botones y no un desplegable: son tres opciones, caben, y un desplegable
 * esconde detras de un click algo que tiene que verse de inmediato. Alguien que
 * cae en una pagina en un idioma que no habla necesita ENCONTRAR el cambio, no
 * buscarlo.
 *
 * Lo guarda una accion de servidor. Escribir la cookie desde el navegador
 * dejaria el HTML ya pintado en el idioma anterior hasta la siguiente
 * navegacion, y el usuario apretaria dos veces creyendo que no funciono.
 */
export function SelectorDeIdioma({
  actual,
  elegir,
  etiqueta,
}: {
  actual: Idioma;
  elegir: (codigo: string) => Promise<void>;
  etiqueta: string;
}) {
  const [pendiente, startTransition] = useTransition();

  return (
    <div
      role="group"
      aria-label={etiqueta}
      className="flex items-center rounded-lg border border-neutral-800 p-0.5"
    >
      {IDIOMAS.map((i) => {
        const activo = i.codigo === actual;
        return (
          <button
            key={i.codigo}
            type="button"
            lang={i.codigo}
            title={i.nombre}
            aria-current={activo}
            disabled={pendiente || activo}
            onClick={() => startTransition(() => elegir(i.codigo))}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
              activo
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-200 disabled:opacity-50"
            }`}
          >
            {i.corto}
          </button>
        );
      })}
    </div>
  );
}
