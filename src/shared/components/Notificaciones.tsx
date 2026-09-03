"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Los toasts de la app: confirmar que algo paso, o avisar que algo fallo,
 * cuando no hay un lugar natural en la pantalla para decirlo.
 *
 * NO REEMPLAZA EL ERROR INLINE DE UN FORMULARIO. Un formulario con campos —la
 * ficha del evento, el login— ya muestra su error pegado al campo o al boton,
 * y ese mensaje tiene que quedarse a la vista mientras la persona lo corrige:
 * un toast que desaparece solo a los pocos segundos seria peor ahi. Los toasts
 * son para lo que NO tiene un lugar propio: un boton de publicar, un borrado,
 * un cambio de estado — acciones sueltas donde la unica alternativa hoy es que
 * no pase nada visible.
 *
 * LOS COLORES SON LOS MISMOS QUE YA USA LA APP. `border-red-500/40
 * bg-red-500/10 text-red-200` es el mismo trio que usan los recuadros de error
 * de `FichaDelEvento`, `AuthForm` y la cola de anomalias — no es un sistema de
 * diseño nuevo, es el mismo con forma de tarjeta flotante.
 */
type Tipo = "exito" | "error" | "info";

interface Notificacion {
  id: string;
  tipo: Tipo;
  mensaje: string;
}

interface NotificacionesContexto {
  exito: (mensaje: string) => void;
  error: (mensaje: string) => void;
  info: (mensaje: string) => void;
}

const Contexto = createContext<NotificacionesContexto | null>(null);

// Un error se lee mas despacio que "Guardado": queda mas tiempo antes de
// desaparecer solo.
const DURACION_MS: Record<Tipo, number> = {
  exito: 4000,
  info: 4000,
  error: 7000,
};

const ESTILOS: Record<Tipo, string> = {
  exito: "border-lime-400/40 bg-lime-400/10 text-lime-100",
  error: "border-red-500/40 bg-red-500/10 text-red-100",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-100",
};

export function ProveedorDeNotificaciones({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([]);

  const quitar = useCallback((id: string) => {
    setNotificaciones((n) => n.filter((x) => x.id !== id));
  }, []);

  const notificar = useCallback(
    (tipo: Tipo, mensaje: string) => {
      const id = crypto.randomUUID();
      setNotificaciones((n) => [...n, { id, tipo, mensaje }]);
      setTimeout(() => quitar(id), DURACION_MS[tipo]);
    },
    [quitar],
  );

  const valor = useMemo<NotificacionesContexto>(
    () => ({
      exito: (mensaje) => notificar("exito", mensaje),
      error: (mensaje) => notificar("error", mensaje),
      info: (mensaje) => notificar("info", mensaje),
    }),
    [notificar],
  );

  return (
    <Contexto.Provider value={valor}>
      {children}

      {/* `pointer-events-none` en el contenedor y `pointer-events-auto` en
          cada tarjeta: el area vacia alrededor de los toasts no puede tapar
          clicks en la pagina de atras, pero cada toast si tiene que
          recibirlos para que el boton de cerrar funcione. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
        aria-live="assertive"
      >
        {notificaciones.map((n) => (
          <Toast key={n.id} notificacion={n} alCerrar={() => quitar(n.id)} />
        ))}
      </div>
    </Contexto.Provider>
  );
}

function Toast({
  notificacion,
  alCerrar,
}: {
  notificacion: Notificacion;
  alCerrar: () => void;
}) {
  return (
    <div
      role={notificacion.tipo === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border p-4 text-sm shadow-xl shadow-black/40 ${ESTILOS[notificacion.tipo]}`}
    >
      <p className="flex-1">{notificacion.mensaje}</p>
      <button
        type="button"
        onClick={alCerrar}
        aria-label="Cerrar"
        className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

export function useNotificaciones(): NotificacionesContexto {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error(
      "useNotificaciones() necesita <ProveedorDeNotificaciones> en un ancestro.",
    );
  }
  return contexto;
}

/**
 * Muestra un toast de error automaticamente cuando el `error` de un
 * `useActionState` cambia — el atajo para el patron mas comun del proyecto
 * (`FormState = { error: string | null }`, presente en unos 30 formularios).
 *
 * SOLO EL ERROR, NUNCA EL EXITO. La mayoria de estas acciones redirigen
 * cuando salen bien (`updateEvent`, `createDivision`, etc.), y ahi el
 * componente se desmonta antes de que un efecto pueda dispararse: la
 * navegacion misma ya es la confirmacion. Inventar un "exito" generico
 * detectando la transicion pending→sin-error seria fragil (una accion que no
 * cambia nada tambien pasa por ahi) y no vale la pena: donde hace falta un
 * toast de exito explicito, se llama `useNotificaciones().exito(...)` a mano
 * despues del `await`, como en `BotonPublicar`.
 */
export function useToastDeEstado(estado: { error: string | null }) {
  const { error } = useNotificaciones();
  const anterior = useRef<string | null>(null);

  useEffect(() => {
    if (estado.error && estado.error !== anterior.current) error(estado.error);
    anterior.current = estado.error;
  }, [estado.error, error]);
}
