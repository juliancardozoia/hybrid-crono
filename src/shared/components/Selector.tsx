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
 * ya no tenia de que ancho estirarse.
 *
 * EL DIV SIEMPRE VA CON `!p-0`, SIN IMPORTAR QUE TRAIGA `className`. Un
 * `py-3` pasado para igualar la altura del select a la de un `Field` (ver
 * `CLASE_INPUT` en `SimpleForm.tsx`) tambien le caia AL DIV —que no tiene
 * borde ni fondo propios, asi que el padding no se ve como caja, se ve como
 * un corrimiento: el borde del select quedaba unos pixeles mas abajo que el
 * de un `<input>` vecino en la misma fila de grilla, aunque las dos
 * etiquetas midieran lo mismo. Bug real, reportado como "País y DNI no
 * estan alineados" en `AltaDeAtleta`. El `!` fuerza que el div nunca tenga
 * padding propio sin importar el orden de las clases en el string.
 */
export function Selector({
  className = "",
  disabled,
  error,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  /** El borde pasa a rojo. Prop propio en vez de pisar el color por
   *  `className`: dos clases de `border-color` en el mismo string dependen
   *  del orden en que Tailwind las genero, no del orden en que se escriben —
   *  frágil para algo que necesita ganar siempre. */
  error?: boolean;
}) {
  return (
    <div className={`relative !p-0 ${className}`}>
      <select
        disabled={disabled}
        aria-invalid={error}
        className={`w-full appearance-none rounded-xl border bg-neutral-900 px-3 py-2.5 pr-9 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 ${error ? "border-red-500/60" : "border-neutral-700"} ${className}`}
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
