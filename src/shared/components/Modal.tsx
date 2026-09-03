"use client";

import { useEffect, useRef } from "react";
import { useCargaMientras } from "./Carga";

/**
 * Modal generico sobre `<dialog>` nativo.
 *
 * NO ES UN PORTAL A MANO. El navegador ya resuelve el apilamiento (top layer),
 * el foco (atrapa el tab adentro) y el cierre con Escape — reimplementarlo con
 * `position: fixed` y un div a nivel de body es reinventar algo que el
 * elemento ya hace bien, y sin los casos raros de foco que un div no atrapa
 * solo.
 *
 * `showModal()`/`close()` son IMPERATIVOS: `<dialog open>` declarativo no pinta
 * el backdrop ni atrapa el foco, asi que el `open`/`abierto` del componente se
 * sincroniza con un efecto en vez de pasarse directo como atributo.
 *
 * Clickear el backdrop cierra: el click en el `<dialog>` mismo (no en su
 * contenido, que esta adentro de un div hijo) solo puede venir del area que el
 * navegador pinta afuera del contenido — es el truco estandar para esto.
 */
export function Modal({
  abierto,
  alCerrar,
  titulo,
  children,
  ancho = "max-w-lg",
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  children: React.ReactNode;
  /** Clase de ancho maximo de Tailwind. Los modales con formularios largos
   *  (parametros de una categoria) necesitan mas que un dialogo de confirmar. */
  ancho?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (abierto && !dialog.open) dialog.showModal();
    if (!abierto && dialog.open) dialog.close();
  }, [abierto]);

  return (
    <dialog
      ref={ref}
      onClose={alCerrar}
      onClick={(e) => {
        if (e.target === ref.current) alCerrar();
      }}
      // `m-auto` es lo que centra un `<dialog>` nativo: el navegador lo abre
      // con `position: fixed; inset: 0` y se centra adentro de esa caja con
      // `margin: auto` — pero el preflight de Tailwind resetea TODOS los
      // margenes a 0 por defecto, asi que sin esto el dialogo queda pegado a
      // una esquina en vez de centrado.
      className={`m-auto w-full ${ancho} rounded-2xl border border-neutral-800 bg-neutral-950 p-0 text-neutral-100 backdrop:bg-black/70`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 p-4">
        <h3 className="font-semibold">{titulo}</h3>
        <button
          type="button"
          onClick={alCerrar}
          className="rounded-lg px-2 py-1 text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

/**
 * El pie compartido de un formulario adentro de un modal: UN Cancelar y UN
 * Guardar, nunca mas de un boton de guardar por modal. `guardarId` asocia el
 * boton al `<form>` por su atributo HTML `form=`, para que pueda vivir fuera
 * del `<form>` —por ejemplo despues de una seccion que no es parte de el,
 * como los codigos de descuento— sin dejar de dispararlo.
 *
 * TAMBIEN ENGANCHA EL OVERLAY GLOBAL. `guardando` ya le llegaba al boton como
 * boolean —no via `useFormStatus`, porque este boton vive FUERA del `<form>`
 * que envia— asi que el enganche es un efecto que sincroniza ese boolean con
 * `useCarga()`, el mismo patron que `BotonDeEnvio` pero a partir de una prop
 * en vez de leerlo del DOM.
 *
 * EL OVERLAY SE VE ARRIBA DEL MODAL A PROPOSITO: `ProveedorDeCarga` lo pinta
 * en su propio `<dialog>`, no en un div `fixed` comun — un `<dialog>` abierto
 * con `showModal()` DESPUES de este vive mas arriba en el "top layer" del
 * navegador, asi que gana. Ver el comentario de `Carga.tsx`.
 *
 * Y CIERRA EL MODAL SOLO AL GUARDAR SIN ERROR. Antes cada modal (alta de
 * categoria, alta de atleta, edicion de categoria) llamaba a
 * `useCerrarAlGuardar` por su cuenta, y bastaba con que uno se olvidara —o
 * que el "cancelar" que le pasaba no fuera de verdad el que cierra el
 * `<dialog>`— para que ese modal en particular se quedara abierto despues de
 * guardar. Ahora es una sola vez, ACA, y ningun modal que use
 * `BotonesDeModal` puede quedarse sin este comportamiento.
 */
export function BotonesDeModal({
  cancelar,
  guardando,
  error,
  guardarId,
  etiqueta = "Guardar",
  mensajeDeCarga,
}: {
  cancelar: () => void;
  guardando: boolean;
  /** El error del `useActionState` que maneja este `<form>`. Con error, el
   *  modal se queda abierto y el mensaje a la vista; sin el, se cierra solo. */
  error: string | null;
  /** El `id` del `<form>` que este boton envia. */
  guardarId: string;
  etiqueta?: string;
  mensajeDeCarga?: string;
}) {
  useCargaMientras(guardando, mensajeDeCarga);
  useCerrarAlGuardar(guardando, error, cancelar);

  return (
    <div className="mt-6 flex justify-end gap-2 border-t border-neutral-800 pt-5">
      <button
        type="button"
        onClick={cancelar}
        className="rounded-xl border border-neutral-700 px-4 py-2.5 text-sm hover:bg-neutral-900"
      >
        Cancelar
      </button>
      <button
        type="submit"
        form={guardarId}
        disabled={guardando}
        className="rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
      >
        {guardando ? "Guardando…" : etiqueta}
      </button>
    </div>
  );
}

/**
 * Cierra el modal solo cuando una accion que estaba en curso termina SIN
 * error: crear o guardar algo y ver como el modal se cierra solo es mejor que
 * quedarse mirando el mismo formulario despues de guardar. Si hubo error, el
 * modal se queda abierto con el mensaje a la vista.
 */
export function useCerrarAlGuardar(
  pending: boolean,
  error: string | null,
  cerrar: () => void,
) {
  const estabaPendiente = useRef(false);

  useEffect(() => {
    if (estabaPendiente.current && !pending && !error) cerrar();
    estabaPendiente.current = pending;
  }, [pending, error, cerrar]);
}
