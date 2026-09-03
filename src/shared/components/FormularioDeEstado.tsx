"use client";

import { useActionState } from "react";
import { BotonDeEnvio } from "./BotonDeEnvio";
import { useToastDeEstado } from "./Notificaciones";

interface EstadoConError {
  error: string | null;
}

/**
 * Un boton suelto que dispara una accion de servidor sin campos —cambiar el
 * estado de la competencia, borrar algo, un alta sin formulario— con el
 * overlay global y un toast de error si algo falla.
 *
 * POR QUE EXISTIA COMO `<form action={fn.bind(null, id)}>` A SECAS. Ese patron
 * sigue siendo correcto para un formulario que no necesita JavaScript en el
 * cliente: el navegador lo envia solo. El problema no era el patron, era que
 * no habia ninguna señal de que algo estuviera pasando mientras la respuesta
 * volvia, y si la funcion de servidor fallaba —un RLS que niega el cambio, un
 * trigger de plan que lo bloquea— no habia forma de que el organizador se
 * enterara. Varias de estas funciones (`setEventStatus`, `borrarCodigo`,
 * `borrarPrueba`, `actualizarAutoasignacion`, entre otras) descartaban ese
 * error en silencio antes de este cambio.
 *
 * La accion tiene que devolver algo con forma `{ error: string | null }`
 * —el `FormState` que ya define cada `actions.ts`—, asi que una funcion de
 * servidor "vacia" como `marcarListo` pasa a tener la firma
 * `(eventId, prevState, formData) => Promise<FormState>` para poder
 * `.bind(null, eventId)` y quedar compatible con `useActionState`.
 *
 * GENERICO EN `TEstado`, NO ATADO A UN `FormState` en particular. Cada feature
 * define el suyo con la misma forma (`{ error: string | null }`), y son
 * estructuralmente el mismo tipo para TypeScript — no hace falta que todas
 * importen la interfaz de una sola feature para poder usar este componente.
 */
export function FormularioDeEstado<TEstado extends EstadoConError>({
  accion,
  estadoInicial,
  etiqueta,
  pendienteTexto,
  mensajeDeCarga,
  className,
  disabled,
  title,
}: {
  accion: (prev: TEstado, formData: FormData) => Promise<TEstado>;
  /** Casi siempre `{ error: null }`; se recibe entero por si el `FormState`
   *  de la feature trae otros campos ademas del error. */
  estadoInicial: TEstado;
  etiqueta: string;
  pendienteTexto?: string;
  mensajeDeCarga?: string;
  className: string;
  disabled?: boolean;
  title?: string;
}) {
  // `useActionState` no infiere bien un `TEstado` generico —sus overloads
  // necesitan que `Awaited<TEstado>` sea el mismo `TEstado`, y con un generico
  // sin resolver TypeScript no puede probarlo—, asi que se lo llama con el
  // tipo base concreto y se recupera `TEstado` en el resultado. La forma real
  // en runtime no cambia: sigue siendo exactamente lo que el llamador paso.
  const [state, formAction] = useActionState(
    accion as unknown as (
      prev: EstadoConError,
      formData: FormData,
    ) => Promise<EstadoConError>,
    estadoInicial as EstadoConError,
  ) as unknown as [TEstado, (formData: FormData) => void, boolean];
  useToastDeEstado(state);

  return (
    <form action={formAction}>
      <BotonDeEnvio
        pendienteTexto={pendienteTexto}
        mensajeDeCarga={mensajeDeCarga}
        className={className}
        disabled={disabled}
        title={title}
      >
        {etiqueta}
      </BotonDeEnvio>
    </form>
  );
}
