"use client";

/**
 * Un permiso o ajuste booleano, con su explicacion al lado.
 *
 * Extraido de `AgregarColaborador.tsx`, que fue el primer lugar que lo usó.
 * Es un checkbox de verdad —no un div con `onClick`— porque asi viaja en el
 * `FormData` sin estado que sincronizar, funciona con teclado y lo anuncia un
 * lector de pantalla. Lo que se ve es un `<span>` estilado sobre el checkbox
 * oculto.
 */
export function Interruptor({
  name,
  titulo,
  detalle,
  activo,
  onChange,
  destacado,
  defaultActivo,
}: {
  name: string;
  titulo: string;
  /** Opcional: cuando el nombre del campo ya dice para que sirve, un
   *  parrafo debajo es ruido. */
  detalle?: string;
  /** CONTROLADO: uso junto con `onChange` (el toggle de "Administrador", que
   *  otros campos del formulario necesitan leer para deshabilitarse). */
  activo?: boolean;
  onChange?: (v: boolean) => void;
  destacado?: boolean;
  /** NO CONTROLADO: valor inicial cuando nadie necesita leer el estado en
   *  vivo — el caso comun, un permiso que solo viaja en el FormData al
   *  enviar. Ignorado si se pasa `onChange`. */
  defaultActivo?: boolean;
}) {
  const controlado = onChange !== undefined;

  return (
    <label
      className={`flex w-full cursor-pointer items-start justify-between gap-4 rounded-2xl border p-4 transition-colors ${
        destacado
          ? "border-neutral-700 bg-neutral-900/60"
          : "border-neutral-800 hover:border-neutral-700"
      }`}
    >
      <span className="min-w-0">
        <span className="block font-medium">{titulo}</span>
        {detalle && (
          <span className="mt-0.5 block text-sm leading-relaxed text-neutral-500">
            {detalle}
          </span>
        )}
      </span>

      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          name={name}
          checked={controlado ? activo : undefined}
          onChange={controlado ? (e) => onChange(e.target.checked) : undefined}
          defaultChecked={controlado ? undefined : (defaultActivo ?? false)}
          className="peer sr-only"
        />
        <span className="block h-6 w-11 rounded-full bg-neutral-700 transition-colors peer-checked:bg-lime-400 peer-focus-visible:ring-2 peer-focus-visible:ring-lime-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-neutral-950" />
        <span className="absolute top-1 left-1 block h-4 w-4 rounded-full bg-neutral-950 transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
