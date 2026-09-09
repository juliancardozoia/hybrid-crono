"use client";

import { useActionState } from "react";
import { BotonDeEnvio } from "./BotonDeEnvio";
import { Selector } from "./Selector";
import { MensajeDeError } from "./MensajeDeError";

export interface SimpleFormState {
  error: string | null;
}

const initial: SimpleFormState = { error: null };

/** Formulario chico con estado de accion de servidor. Evita repetir el cableado. */
export function SimpleForm({
  action,
  submitLabel,
  hidden,
  children,
}: {
  action: (
    prev: SimpleFormState,
    formData: FormData,
  ) => Promise<SimpleFormState>;
  submitLabel: string;
  hidden?: Record<string, string>;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initial);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {hidden &&
        Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

      {children}

      {state.error && (
        <MensajeDeError>{state.error}</MensajeDeError>
      )}

      <div>
        <BotonDeEnvio
          pendienteTexto="Guardando…"
          className="rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
        >
          {submitLabel}
        </BotonDeEnvio>
      </div>
    </form>
  );
}

/**
 * La cascara visual de un campo: label, el control (lo que sea), y un slot de
 * ayuda/error debajo. `Field` y `Select` la usan por dentro; un formulario
 * con un control que no es ni input ni select (un textarea, un checkbox
 * suelto) tambien puede envolverse en esto para no reinventar el label ni el
 * slot de abajo a mano.
 *
 * EL SLOT DE ABAJO SOLO SE RENDERIZA SI HAY ALGO QUE DECIR. Reservaba una
 * linea siempre (`min-h-[1rem]`), tuviera texto o no, para que dos campos en
 * la misma fila con distinta ayuda no quedaran desalineados. En la practica
 * eso sumaba un espacio muerto fijo debajo de CADA campo del formulario —
 * la mayoria no tiene ayuda ni error — y con seis u ocho campos por modal se
 * notaba como "demasiado espacio entre lineas", que fue el problema
 * reportado. El label y el control de un campo van siempre PRIMERO en el
 * flujo (arriba se alinean solos); lo unico que varia es cuanto ocupa la
 * linea de abajo, y ningun campo de esta app lleva borde o fondo propio que
 * haga visible esa diferencia — asi que no reservarla no desalinea nada que
 * se vea.
 *
 * ERROR TIENE PRIORIDAD SOBRE AYUDA: son el mismo slot, nunca las dos a la
 * vez — mostrar las dos seria redundante y ocuparia mas alto que sus vecinos.
 */
export function CampoBase({
  label,
  ayuda,
  error,
  children,
}: {
  label: string;
  ayuda?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const texto = error ?? ayuda;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {texto && (
        <span className={`text-xs ${error ? "text-red-400" : "text-neutral-600"}`}>
          {texto}
        </span>
      )}
    </label>
  );
}

/**
 * La altura exacta de un `Field`/`Select` (py-3 + borde). Exportada para que
 * un valor de solo lectura envuelto en `CampoBase` (por ejemplo "Puntuación"
 * en `ParametrosDeCategoria`) pueda usar el mismo padding en vez de inventar
 * el suyo — sin esto, dos campos en la misma fila terminaban con distinta
 * altura sin que nada en el código lo explicara.
 */
export const CLASE_INPUT =
  "rounded-xl border bg-transparent px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950";

export function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  defaultValue,
  autoComplete,
  minLength,
  min,
  max,
  ayuda,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number;
  autoComplete?: string;
  minLength?: number;
  min?: number;
  max?: number;
  /** Una linea bajo el campo, para reglas que el placeholder no alcanza a decir. */
  ayuda?: string;
  /** Mismo slot que `ayuda`, en rojo — nunca las dos a la vez. */
  error?: string;
}) {
  return (
    <CampoBase label={label} ayuda={ayuda} error={error}>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        minLength={minLength}
        min={min}
        max={max}
        aria-invalid={Boolean(error)}
        className={`${CLASE_INPUT} ${error ? "border-red-500/60" : "border-neutral-700"}`}
      />
    </CampoBase>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  required,
  ayuda,
  error,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  required?: boolean;
  ayuda?: string;
  /** Mismo slot que `ayuda`, en rojo — nunca las dos a la vez. */
  error?: string;
}) {
  return (
    <CampoBase label={label} ayuda={ayuda} error={error}>
      <Selector
        name={name}
        defaultValue={defaultValue}
        required={required}
        error={Boolean(error)}
        // El input de Field es `py-3`; el Selector base es `py-2.5`. Sin este
        // override, un Field y un Select en la misma fila (FieldRow) quedan
        // con distinta altura — es exactamente el desnivel que reporto la
        // auditoria en los formularios que NO pasan por este componente.
        className="w-full py-3"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Selector>
    </CampoBase>
  );
}

/**
 * Fila de campos que en pantalla chica se apilan.
 *
 * `gap-4` ES EL ESTANDAR: tanto entre dos campos de la misma fila como entre
 * una fila de campos y la siguiente. Antes convivian `gap-3` y `gap-4` para
 * el mismo salto visual segun el archivo (`AltaDeAtleta`, `ParametrosDeCategoria`),
 * asi que un modal se veia mas "apretado" que otro sin ninguna razon de
 * contenido. Un formulario que arma sus filas a mano (sin `FieldRow`) tiene
 * que usar este mismo valor, tanto en el `grid` como en el `flex flex-col`
 * que envuelve varias filas.
 */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
