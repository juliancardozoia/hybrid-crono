/**
 * El banner de error de formulario/accion estaba repetido a mano en mas de
 * cuarenta lugares, casi siempre con el mismo string de clases
 * (`rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm
 * text-red-300`) y a veces con pequenas variaciones sin motivo (rounded-lg,
 * p-2, text-red-200) que no comunican nada distinto. `compacto` es la unica
 * variante real que existia en el codigo: un banner mas chico para un
 * espacio ya apretado (una fila de tabla, un campo suelto).
 */
export function MensajeDeError({
  children,
  compacto = false,
  className = "",
}: {
  children: React.ReactNode;
  compacto?: boolean;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={`rounded-xl border border-red-500/40 bg-red-500/10 text-sm text-red-300 ${
        compacto ? "px-2 py-1" : "p-3"
      } ${className}`}
    >
      {children}
    </p>
  );
}
