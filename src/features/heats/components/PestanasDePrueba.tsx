"use client";

/**
 * Pestañas genéricas de dos niveles, compartidas entre /heats y la torre de
 * control: ETAPA arriba (si la competencia tiene más de una) y PRUEBA debajo.
 *
 * Antes las dos pantallas apilaban TODAS las pruebas —y dentro de cada una,
 * TODAS las categorías— una debajo de la otra con un simple selector de
 * filtro. Con varias etapas, varios WODs y una categoría con muchos atletas
 * (heats), la página se volvía una lista larguísima e imposible de escanear.
 * La jerarquía real de una competencia es etapa → prueba → categoría, y las
 * pestañas la hacen explícita: se ve UNA prueba de UNA etapa a la vez, que es
 * la pregunta real el día del evento ("qué está pasando en ESTE WOD"), no
 * "dame todo junto".
 *
 * `variante="principal"` es la pastilla rellena (etapa, el nivel de arriba);
 * `variante="secundaria"` es el subrayado que ya usa el resto de la app
 * (prueba, anidada debajo). Dos estilos distintos para dos niveles distintos:
 * si se vieran igual, no se entendería cuál manda sobre cuál.
 */
export function Pestanas({
  items,
  activa,
  onCambiar,
  variante = "secundaria",
}: {
  items: Array<{ id: string; label: string }>;
  activa: string;
  onCambiar: (id: string) => void;
  variante?: "principal" | "secundaria";
}) {
  if (items.length <= 1) return null;

  if (variante === "principal") {
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const esActiva = item.id === activa;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onCambiar(item.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                esActiva
                  ? "bg-lime-400 text-lime-950"
                  : "bg-neutral-900 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1 border-b border-neutral-800">
      {items.map((item) => {
        const esActiva = item.id === activa;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onCambiar(item.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              esActiva
                ? "border-lime-400 text-lime-400"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
