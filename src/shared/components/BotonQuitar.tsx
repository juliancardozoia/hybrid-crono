"use client";

/**
 * El "✕" que dispara quitar/eliminar. UN SOLO TAMAÑO EN TODA LA APP.
 *
 * ANTES CADA PANTALLA TENÍA EL SUYO: `h-11 w-11` (heats, atletas,
 * penalizaciones) — el tap target de 44px pensado para una tarjeta táctil —
 * al lado de un simple `px-2` sin alto fijo (documentos, códigos de
 * descuento, categorías, pruebas). El mismo gesto se veía grande en una
 * pantalla y chico en la de al lado. Acá queda un tamaño intermedio: ni el
 * tap target de 44px de una tarjeta, ni un link de texto sin padding
 * vertical — suficiente para tocar sin agrandar filas densas de escritorio.
 *
 * SOLO EL BOTÓN, NO LA CONFIRMACIÓN. Cada llamador sigue decidiendo si hace
 * falta un `Modal` de confirmación antes de disparar — eso depende de qué
 * tan destructiva es cada acción, no del tamaño del ícono que la dispara.
 */
export function BotonQuitar({
  onClick,
  title,
  className = "",
}: {
  onClick: () => void;
  title: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-900 hover:text-red-400 ${className}`}
    >
      ✕
    </button>
  );
}
