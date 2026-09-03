/** El giro de carga. Un solo lugar para el trazo: lo usan el overlay global
 *  (`Carga.tsx`) y el overlay por-modal (`Modal.tsx`), y tienen que verse
 *  identicos — son el mismo "esto esta trabajando" en dos escalas distintas. */
export function Spinner({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-spin rounded-full border-4 border-neutral-700 border-t-lime-400 ${className}`}
    />
  );
}
