"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

export interface SimpleFormState {
  error: string | null;
}

const initial: SimpleFormState = { error: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
    >
      {pending ? "Guardando…" : label}
    </button>
  );
}

/** Formulario chico con estado de accion de servidor. Evita repetir el cableado. */
export function SimpleForm({
  action,
  submitLabel,
  hidden,
  children,
}: {
  action: (prev: SimpleFormState, formData: FormData) => Promise<SimpleFormState>;
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
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400"
      />
    </label>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 outline-none focus:border-lime-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Fila de campos que en pantalla chica se apilan. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
