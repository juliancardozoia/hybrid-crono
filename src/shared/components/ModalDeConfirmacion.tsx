"use client";

import { useActionState, useEffect, useRef } from "react";
import { claseDeBoton, type VarianteDeBoton } from "./Boton";
import { useCargaMientras } from "./Carga";
import { Modal } from "./Modal";
import { useToastDeEstado } from "./Notificaciones";

interface EstadoConError {
  error: string | null;
}

/**
 * El modal de "¿estas seguro?": una pregunta, Cancelar, y un boton que
 * dispara una accion de servidor sin campos. Es el mismo patron que ya
 * repetian a mano "Largar heat"/"Deshacer Inicio"/DNF (`TorreDeHeats.tsx`),
 * "Quitar heat" (`PantallaDeHeats.tsx`), "Quitar prueba"/"Quitar
 * penalizacion"/"Quitar atleta o equipo" y "Eliminar categoria" —ocho
 * copias del mismo `<Modal>` + parrafo + `Boton secondary` + boton de
 * envio, cada una con su propio ancho y sin ninguna cerrando el dialogo
 * despues de confirmar.
 *
 * SE CIERRA SOLO AL TERMINAR LA ACCION, HAYA O NO ERROR — a diferencia de
 * `BotonesDeModal` (los modales CON formulario), que a proposito solo cierra
 * si no hubo error, para no perder lo que la persona tipeo. Aca no hay nada
 * que preservar: el mensaje de confirmacion ya esta completo antes de tocar
 * el boton. Y hace falta cerrar TAMBIEN en el error, porque el `<dialog>`
 * vive en el "top layer" del navegador —por encima de CUALQUIER z-index,
 * incluido el contenedor de toasts (`z-[110]` en `Notificaciones.tsx`)—: si
 * el modal quedara abierto, el toast de error quedaria pintado DETRAS suyo,
 * invisible, hasta que alguien cerrara el modal a mano. Bug real, reportado
 * con captura: "Largar heat" fallaba (la competencia seguia en borrador) y
 * el aviso de error jamas se veia, tapado por el propio modal que seguia
 * mostrando "Confirmar largada" como si nada hubiera pasado.
 *
 * MAS ANCHO QUE LOS OCHO ORIGINALES (`max-w-md`, no `max-w-sm`): en
 * escritorio se leian angostos para un dialogo con dos botones al pie, y un
 * mensaje largo (un nombre de equipo o categoria largo) forzaba el ancho
 * minimo posible. `break-words` en el mensaje y `flex-wrap` en la fila de
 * botones evitan que una palabra o una etiqueta larga dispare scroll
 * horizontal — nunca deberia hacer falta con un dialogo de un par de
 * lineas, pero es la misma defensa que ya vale para cualquier texto que no
 * controla la app (nombre de un atleta, de una categoria).
 */
export function ModalDeConfirmacion<TEstado extends EstadoConError>({
  abierto,
  alCerrar,
  titulo,
  descripcion,
  accion,
  estadoInicial,
  etiquetaConfirmar,
  etiquetaPendiente = "Un momento…",
  mensajeDeCarga,
  variante = "destructive",
  ancho = "max-w-md",
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  descripcion: React.ReactNode;
  accion: (prev: TEstado, formData: FormData) => Promise<TEstado>;
  /** Casi siempre `{ error: null }`. */
  estadoInicial: TEstado;
  etiquetaConfirmar: string;
  etiquetaPendiente?: string;
  mensajeDeCarga?: string;
  variante?: VarianteDeBoton;
  /** Clase de ancho maximo de Tailwind — ver el comentario de `Modal`. */
  ancho?: string;
}) {
  // Mismo truco de tipos que `FormularioDeEstado`: `useActionState` no infiere
  // bien un `TEstado` generico, asi que se lo llama con el tipo base concreto
  // y se recupera `TEstado` en el resultado.
  const [state, formAction, pending] = useActionState(
    accion as unknown as (
      prev: EstadoConError,
      formData: FormData,
    ) => Promise<EstadoConError>,
    estadoInicial as EstadoConError,
  ) as unknown as [TEstado, (formData: FormData) => void, boolean];

  useToastDeEstado(state);
  useCargaMientras(pending, mensajeDeCarga);

  const estabaPendiente = useRef(false);
  useEffect(() => {
    if (estabaPendiente.current && !pending) alCerrar();
    estabaPendiente.current = pending;
  }, [pending, alCerrar]);

  return (
    <Modal abierto={abierto} alCerrar={alCerrar} titulo={titulo} ancho={ancho}>
      <div className="text-left">
        <p className="break-words text-sm text-neutral-300">{descripcion}</p>
        <form action={formAction}>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={alCerrar}
              disabled={pending}
              className={claseDeBoton({ variante: "secondary", compacto: true })}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className={claseDeBoton({ variante, compacto: true })}
            >
              {pending ? etiquetaPendiente : etiquetaConfirmar}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
