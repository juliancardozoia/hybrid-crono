import type { SelectHTMLAttributes } from "react";
import { Icono } from "./Icono";

/**
 * El UNICO estilo de `<select>` de toda la app.
 *
 * ANTES CADA PANTALLA SE HACIA EL SUYO. Once archivos definian su propia
 * constante local `selector` (variando el padding sin ninguna razon), nueve
 * mas hardcodeaban la clase inline, y uno (`CodigosDeDescuento`) directamente
 * reusaba la clase de un `<input>` de texto — ese select se veia identico a
 * un campo de texto, sin ninguna señal de que era desplegable. El resultado:
 * media app con flecha nativa del navegador, la otra media con
 * `appearance-none` y SIN flecha de reemplazo (se distinguian solo por el
 * color de fondo), y una pantalla donde ni eso.
 *
 * LA FLECHA ES SIEMPRE LA MISMA: el icono `flecha` (una `>`) rotado 90°, para
 * no agregar un icono nuevo — mismo criterio que el resto de `Icono.tsx`, que
 * reusa los pocos trazos que ya existen en vez de sumar uno por caso de uso.
 *
 * SIN ANCHO PROPIO A PROPOSITO. Un filtro angosto (`w-auto`) y un campo de
 * formulario (`w-full`) conviven en la app; forzar un ancho fijo en el
 * componente de base rompe a los primeros.
 *
 * `className` SE APLICA A LOS DOS ELEMENTOS: el `<div>` que envuelve (por el
 * icono) y el `<select>` de adentro. El select necesita el layout (`w-full`,
 * `flex-1`, `w-20`) para su propio ancho, pero el elemento que en verdad
 * ocupa un lugar en un `flex`/`grid` del llamador es el DIV —el select vive
 * adentro, en `position: relative`— asi que sin esto un `flex-1` pasado por
 * className nunca llegaba a estirar el contenedor real, solo un select que
 * ya no tenia de que ancho estirarse. Las clases de texto/padding que
 * tambien viajan en `className` (`py-3`, `text-sm`) no le hacen nada visible
 * a un div vacio, asi que aplicarlas dos veces es inofensivo.
 */
export function Selector({
  className = "",
  disabled,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={`relative ${className}`}>
      <select
        disabled={disabled}
        className={`w-full appearance-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 pr-9 text-sm outline-none transition-colors focus:border-lime-400 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      />
      <Icono
        nombre="flecha"
        className={`pointer-events-none absolute top-1/2 right-3 h-3 w-3 -translate-y-1/2 rotate-90 ${
          disabled ? "text-neutral-700" : "text-neutral-500"
        }`}
      />
    </div>
  );
}
