"use client";

import { useFormStatus } from "react-dom";
import { useCargaMientras } from "./Carga";

/**
 * El boton de "Guardar" de un `<form action={...}>`, con el overlay global
 * enganchado.
 *
 * REEMPLAZA AL `SubmitButton`/`Boton` LOCAL QUE YA HABIA EN VARIOS
 * FORMULARIOS. `AuthForm` y `FichaDelEvento` —entre otros— tenian cada uno su
 * propia copia de "leer `useFormStatus`, deshabilitar mientras pending,
 * cambiar el texto". La logica era identica en los dos; lo unico que
 * cambiaba era la clase. Esto es esa misma logica, una sola vez, mas el
 * enganche al overlay que antes ninguno de los dos tenia.
 *
 * NO TRAE VARIANTES DE COLOR. Cada boton de la app ya tiene su propia clase
 * —primario lima, secundario con borde, destructivo en rojo— y esas clases
 * viven en cada pantalla. Inventar un mapa de variantes (`primario` |
 * `secundario` | ...) obligaria a que las clases ganen por orden de fuente en
 * Tailwind en vez de por lo que el llamador quiere, que es exactamente el tipo
 * de bug dificil de ver. Mas simple: este componente no tiene opinion sobre
 * el color, `className` es obligatorio y es el mismo que ya tenia el boton
 * que reemplaza.
 *
 * `useFormStatus()` exige ser un DESCENDIENTE del `<form>`, no el mismo
 * componente que lo declara — por eso este es un componente aparte y no un
 * prop mas de `<form>`.
 */
export function BotonDeEnvio({
  children,
  pendienteTexto = "Un momento…",
  mensajeDeCarga,
  className,
  disabled,
  title,
}: {
  children: React.ReactNode;
  /** Lo que se ve mientras el envio esta en curso. */
  pendienteTexto?: string;
  /** El texto que acompaña al overlay global mientras este envio esta en curso. */
  mensajeDeCarga?: string;
  className: string;
  disabled?: boolean;
  /** Para los botones-icono (un "✕" solo) que dependen del title como
   *  explicacion, ya que su texto visible no dice nada por si solo. */
  title?: string;
}) {
  const { pending } = useFormStatus();
  useCargaMientras(pending, mensajeDeCarga);

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      title={title}
      className={className}
    >
      {pending ? pendienteTexto : children}
    </button>
  );
}
