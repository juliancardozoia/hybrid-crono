"use client";

/**
 * El primitive de boton. NO reemplaza a `BotonDeEnvio` ni a `FormularioDeEstado`
 * —esos siguen sin opinion de color a proposito, ver su propio comentario—,
 * es la base sobre la que `BotonAbrirModal` y `BotonesDeModal` se componen, y
 * el punto de partida para cualquier boton nuevo que hoy se escribiria a mano.
 *
 * POR QUE EXISTE. 38 archivos reimplementaban el boton primario con al menos
 * seis combinaciones de padding y dos de radio para la MISMA pieza visual, y
 * otros 47 hacian lo mismo con el secundario. `claseDeBoton()` es la unica
 * fuente de esas clases; un cambio de tono o de radio se hace una vez aca.
 *
 * TRES EJES, NO UNA LISTA DE BOOLEANOS. `variante` decide el color y el peso
 * semantico, `compacto` decide el tamaño (pagina vs. fila/footer de modal),
 * `iconOnly` decide la forma (cuadrado, con `aria-label` obligatorio en vez
 * de texto visible). No hay `isSmall`/`isRounded`/`isTable`/etc: si hiciera
 * falta una cuarta excepcion, la abstraccion esta mal, no el prop que falta.
 */

export type VarianteDeBoton = "primary" | "secondary" | "destructive" | "ghost";

// SIN `font-*` ACA. Si BASE trajera un peso y la variante otro, las dos
// clases pisan la misma propiedad CSS (`font-weight`) y cual gana depende del
// orden en que Tailwind las generó, no del orden en el string — la app ya se
// mordio esto una vez con `border-color` en `Selector`. Cada variante declara
// su propio peso, UNA sola vez, para que nunca compita con nada.
const BASE =
  "inline-flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950";

// Radio por jerarquia: los botones SIEMPRE son `rounded-xl` en la app —es la
// clase que ya tenian BotonAbrirModal, los botones de TorreDeHeats, el submit
// de SimpleForm, etc.— salvo los icon-only, que siguen el radio chico que ya
// usaban BotonCopiar y la "X" de Modal (`rounded-lg`).
//
// EL PESO DEL TEXTO ES LA SEÑAL DE JERARQUIA, no solo el color. El primario
// —la accion que se espera que alguien tome— es `font-bold` en TODA la app,
// uniforme: "Crear categoría", "Crear atleta", "Confirmar largada" pesan
// exactamente igual. El secundario y el ghost son `font-medium`, mas liviano
// a proposito, para que el primario siga siendo el que se lee primero.
const VARIANTES: Record<VarianteDeBoton, string> = {
  primary: "bg-lime-400 text-lime-950 font-bold hover:bg-lime-300",
  secondary: "border border-neutral-700 text-neutral-100 font-medium hover:bg-neutral-900",
  destructive: "bg-red-500/10 text-red-300 font-semibold hover:bg-red-500/20",
  ghost: "text-neutral-500 font-medium hover:text-neutral-300",
};

/**
 * Genera el string de clases de un boton. Exportado para que componentes que
 * necesitan su PROPIO cableado de estado —`BotonDeEnvio` via `useFormStatus`,
 * `FormularioDeEstado` via `useActionState`— puedan pedir la misma clase sin
 * pasar por el componente `Boton` (que asume un `<button>` de verdad, no un
 * boton que vive fuera de su `<form>` o que necesita otro elemento).
 */
export function claseDeBoton({
  variante,
  compacto = false,
  iconOnly = false,
}: {
  variante: VarianteDeBoton;
  compacto?: boolean;
  iconOnly?: boolean;
}): string {
  const forma = iconOnly
    ? "h-11 w-11 shrink-0 rounded-lg"
    : `rounded-xl ${compacto ? "px-4 py-2.5 text-sm" : "px-5 py-3 text-sm"}`;

  return `${BASE} ${forma} ${VARIANTES[variante]}`;
}

interface BotonPropsBase
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> {
  variante?: VarianteDeBoton;
  /** Tamaño de fila/footer de modal en vez del tamaño de pagina. */
  compacto?: boolean;
  /** Clases extra, para el caso puntual que el primitive no cubre — no para
   *  pisar color ni tamaño, que es lo que `variante`/`compacto` deciden. */
  className?: string;
  cargando?: boolean;
  textoCargando?: string;
  children: React.ReactNode;
}

type BotonProps =
  | (BotonPropsBase & { iconOnly?: false; label?: never })
  | (BotonPropsBase & {
      iconOnly: true;
      /** Obligatorio: sin texto visible, es la unica forma de que un lector
       *  de pantalla sepa que hace este boton. Tambien se usa como `title`. */
      label: string;
    });

export function Boton({
  variante = "primary",
  compacto = false,
  iconOnly = false,
  label,
  className = "",
  cargando = false,
  textoCargando = "Un momento…",
  type = "button",
  disabled,
  title,
  children,
  ...resto
}: BotonProps) {
  return (
    <button
      type={type}
      disabled={disabled || cargando}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : title}
      className={`${claseDeBoton({ variante, compacto, iconOnly })} ${className}`}
      {...resto}
    >
      {cargando && !iconOnly ? textoCargando : children}
    </button>
  );
}
