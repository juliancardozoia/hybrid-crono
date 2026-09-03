"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Spinner } from "./Spinner";

/**
 * El overlay de carga global.
 *
 * POR QUE GLOBAL Y NO POR PANTALLA. Antes, tocar un boton que va al backend no
 * cambiaba nada en la pantalla hasta que la respuesta volvia: para el usuario
 * es indistinguible de "no paso nada", y la reaccion tipica es tocar de nuevo.
 * Un overlay montado UNA vez en el layout raiz resuelve esto en cualquier
 * pantalla sin que cada una tenga que acordarse de armar su propio spinner.
 *
 * CONTADO, NO BOOLEANO. Si dos operaciones se solapan —una carga en curso y el
 * usuario dispara otra— un boolean se pisa: la primera en terminar apaga el
 * overlay aunque la segunda siga viva. Un contador con `activar`/`desactivar`
 * en pares tolera el solape sin coordinacion entre quien lo llama.
 *
 * ES UN `<dialog>`, NO UN DIV `fixed`. Asi es como queda SIEMPRE arriba de
 * todo, incluido un modal ya abierto: un `<dialog>` mostrado con
 * `showModal()` entra al "top layer" del navegador, que ignora el z-index por
 * completo y se pinta arriba de cualquier `position: fixed` de la pagina. Un
 * div fixed comun quedaria atrapado invisible detras de cualquier `<dialog>`
 * que ya estuviera abierto (el de `Modal.tsx`, por ejemplo) — que es
 * exactamente el bug que este componente tenia antes de ser un `<dialog>` el.
 * Como este overlay se abre DESPUES, cuando la accion arranca con el modal ya
 * en pantalla, entra mas arriba en esa pila del navegador y gana. De paso,
 * mientras esta abierto vuelve INERTE todo lo de atras —el modal incluido—:
 * nadie puede interactuar con nada mientras la carga esta en curso.
 *
 * NO SE USA EN LA APP DEL JUEZ. El cronometro y el WOD son offline-first a
 * proposito: el juez nunca espera por la red, y un overlay que bloquea la
 * pantalla mientras se sincroniza rompe esa garantia. Este componente vive en
 * el layout raiz porque es inerte hasta que algo llama `activar()` — la app
 * del juez simplemente no lo hace.
 */
interface CargaContexto {
  activar: (mensaje?: string) => void;
  desactivar: () => void;
}

const Contexto = createContext<CargaContexto | null>(null);

interface Estado {
  contador: number;
  mensaje: string | null;
}

const ESTADO_INICIAL: Estado = { contador: 0, mensaje: null };

export function ProveedorDeCarga({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<Estado>(ESTADO_INICIAL);
  const ref = useRef<HTMLDialogElement>(null);
  const activo = estado.contador > 0;

  // Mismo patron imperativo que `Modal.tsx`: `<dialog open>` declarativo no
  // pinta el backdrop ni entra al "top layer", asi que abrir y cerrar tienen
  // que ser `showModal()`/`close()`.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (activo && !dialog.open) dialog.showModal();
    if (!activo && dialog.open) dialog.close();
  }, [activo]);

  const valor = useMemo<CargaContexto>(
    () => ({
      activar: (msg) =>
        setEstado((e) => ({
          contador: e.contador + 1,
          mensaje: msg ?? e.mensaje,
        })),
      // El mensaje se limpia ACA, dentro del mismo update, en vez de en un
      // efecto separado que reaccione a `contador === 0`: React 19 rechaza un
      // `setState` sincrono dentro de un efecto porque encadena un render
      // extra, y ademas asi el mensaje viejo nunca llega a pintarse ni un
      // frame antes de desaparecer.
      desactivar: () =>
        setEstado((e) => {
          const contador = Math.max(0, e.contador - 1);
          return { contador, mensaje: contador === 0 ? null : e.mensaje };
        }),
    }),
    [],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}

      <dialog
        ref={ref}
        // Que Escape no lo cierre: mientras algo esta en curso no hay forma
        // de cancelarlo tocando una tecla.
        onCancel={(e) => e.preventDefault()}
        className="m-0 h-dvh max-h-none w-dvw max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
      >
        {/* El `flex` vive ACA, no en el `<dialog>`. Si el `<dialog>` mismo
            tuviera una clase de `display`, esa regla de autor le ganaria por
            cascada al `display: none` que el navegador le pone cuando esta
            cerrado —el origen "autor" pesa mas que "user-agent" aunque el
            selector nativo sea mas especifico— y quedaria visible siempre,
            aunque `activo` fuera `false`. */}
        <div
          role="status"
          aria-live="polite"
          className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-950/70 backdrop-blur-sm"
        >
          <Spinner />
          <p className="text-sm font-medium text-neutral-200">
            {estado.mensaje ?? "Un momento…"}
          </p>
        </div>
      </dialog>
    </Contexto.Provider>
  );
}

export function useCarga(): CargaContexto {
  const contexto = useContext(Contexto);
  if (!contexto)
    throw new Error("useCarga() necesita <ProveedorDeCarga> en un ancestro.");
  return contexto;
}

/**
 * Sincroniza un `pending` booleano con el overlay global.
 *
 * PARA CUANDO `pending` NO SALE DE `useFormStatus()`. Ese hook exige ser un
 * DESCENDIENTE del `<form>` en el arbol de React — no alcanza con el atributo
 * HTML `form="..."` que asocia un boton de afuera con un formulario. Donde el
 * boton vive fuera del form (`FormularioInscripcionAsistente`,
 * `BotonesDeModal`) o el `pending` sale de `useActionState`/`useTransition`
 * directo, este hook hace el mismo enganche que ya hace `BotonDeEnvio` por
 * dentro, sin duplicar el efecto en cada lugar.
 */
export function useCargaMientras(pending: boolean, mensaje?: string) {
  const { activar, desactivar } = useCarga();

  useEffect(() => {
    if (!pending) return;
    activar(mensaje);
    return () => desactivar();
  }, [pending, activar, desactivar, mensaje]);
}
