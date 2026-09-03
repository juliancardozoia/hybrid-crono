"use client";

import { useTransition } from "react";
import { togglePublicacion } from "../actions";
import { useCarga } from "@/shared/components/Carga";
import { useNotificaciones } from "@/shared/components/Notificaciones";

/**
 * Publica o despublica la competencia.
 *
 * Despublicar no borra nada: la competencia sigue existiendo y funcionando,
 * simplemente deja de aparecer en el catalogo. Por eso el boton no pide
 * confirmacion.
 *
 * ES EL EJEMPLO DE TOAST, NO DE ERROR INLINE. A diferencia de un formulario
 * con campos, aca no hay ningun lugar natural donde dejar un mensaje pegado —
 * es un boton suelto. Antes el error vivia en un recuadro que aparecia debajo
 * y se quedaba ahi para siempre hasta el proximo click; ahora es un toast que
 * el overlay global ya venia a resolver: mientras `togglePublicacion` corre,
 * la pantalla entera se opaca, y al terminar el resultado se anuncia una sola
 * vez y se va solo.
 */
export function BotonPublicar({
  eventId,
  publicado,
  slug,
}: {
  eventId: string;
  publicado: boolean;
  slug: string;
}) {
  const [pendiente, startTransition] = useTransition();
  const { activar, desactivar } = useCarga();
  const { exito, error } = useNotificaciones();

  function alternar() {
    startTransition(async () => {
      activar(publicado ? "Quitando del catálogo…" : "Publicando…");
      try {
        const r = await togglePublicacion(eventId, !publicado);
        if (r.error) {
          error(r.error);
        } else {
          exito(
            publicado ? "Se quitó del catálogo." : "Se publicó en el catálogo.",
          );
        }
      } finally {
        desactivar();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pendiente}
          onClick={alternar}
          className={`rounded-xl px-5 py-3 font-bold transition-colors disabled:opacity-60 ${
            publicado
              ? "border border-neutral-700 text-neutral-300 hover:bg-neutral-900"
              : "bg-lime-400 text-lime-950 hover:bg-lime-300"
          }`}
        >
          {publicado ? "Quitar del catálogo" : "Publicar en el catálogo"}
        </button>

        {publicado && (
          <a
            href={`/eventos/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-lime-400 hover:text-lime-300"
          >
            Ver la ficha pública →
          </a>
        )}
      </div>

      <p className="text-xs text-neutral-500">
        {publicado
          ? "Aparece en el catálogo y cualquiera puede encontrarla."
          : "Solo tú y tu equipo la ven. La competencia funciona igual sin publicar."}
      </p>
    </div>
  );
}
