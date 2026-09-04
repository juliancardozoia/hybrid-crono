"use client";

/**
 * El botón que abre un modal de alta: "Crear categoría", "Crear circuito",
 * "Crear atleta", "Crear heat", "Crear penalización".
 *
 * UN SOLO ESTILO PARA LOS CINCO. Cada uno tenía el suyo —relleno lima acá,
 * con borde allá, `px-4 py-2` en un lado y `px-5 py-3` en otro— y en pantallas
 * que se navegan una detrás de la otra (Divisiones, Circuito, Atletas, Heats,
 * Penalizaciones) un botón que cambia de tamaño y de color según en cuál
 * estés es lo que rompe la sensación de que es la misma aplicación.
 */
export function BotonAbrirModal({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-fit rounded-xl bg-lime-400 px-5 py-3 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
