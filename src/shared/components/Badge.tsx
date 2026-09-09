/**
 * El primitive de badge de estado: solo la CASCARA visual (radio, padding,
 * color de fondo/texto por tono). La semantica de negocio —que texto, que
 * tono le corresponde a cada estado— sigue viviendo en cada feature.
 * `EstadoBadge` (eventos) es el ejemplo: mapea `EventStatus` a texto+tono y
 * renderiza `<Badge>`, no al reves.
 *
 * NO ES PARA TODO INDICADOR DE ESTADO. Un texto+color inline en una fila
 * densa (el "en carrera"/"DNF" de cada carril en la Torre de Control) NO pasa
 * a `Badge`: tiene padding y fondo, y metiendolo en una fila apretada de
 * carriles rompe la densidad que esa pantalla necesita. `Badge` es para
 * estados que hoy ya se pintan como pastilla con fondo — no para inventar
 * pastillas donde no las habia.
 *
 * EL COLOR NUNCA ES LA UNICA SEÑAL. Los tonos son de apoyo; el texto que le
 * pasa el llamador es lo que dice el estado. `activo` se llama distinto de
 * `success` porque no siempre es lo mismo — "En vivo" es un estado activo,
 * no un resultado exitoso, y esa distincion la sigue eligiendo el llamador.
 */

export type TonoDeBadge = "neutral" | "activo" | "exito" | "warning" | "error" | "info";

const TONOS: Record<TonoDeBadge, string> = {
  neutral: "bg-neutral-800 text-neutral-400",
  // Distinto de `exito`: "En vivo" esta pasando AHORA, no es un resultado
  // terminado — misma distincion que ya usa Torre de Control (lima = en
  // curso, esmeralda = termino) y el reloj del juez (FinishCard).
  activo: "bg-lime-500/15 text-lime-300",
  exito: "bg-emerald-500/15 text-emerald-300",
  warning: "bg-amber-500/15 text-amber-300",
  error: "bg-red-500/15 text-red-300",
  info: "bg-sky-500/15 text-sky-300",
};

export function Badge({
  tono = "neutral",
  children,
}: {
  tono?: TonoDeBadge;
  children: React.ReactNode;
}) {
  return (
    <span className={`rounded-lg px-2.5 py-1 text-xs font-medium ${TONOS[tono]}`}>{children}</span>
  );
}
