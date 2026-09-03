import Link from "next/link";
import { Icono } from "@/shared/components/Icono";
import { PASOS, indiceDelPaso } from "../lib/asistente";

/**
 * El indicador de progreso del asistente.
 *
 * LA ETIQUETA VA AL LADO DEL CIRCULO, NO DEBAJO
 *
 * Con el texto debajo, cada paso necesita un ancho fijo para que los titulos no
 * se pisen, y el tramo que los une hay que empujarlo a mano hasta la altura del
 * centro del circulo con un margen magico. Se rompe en cuanto un titulo es mas
 * largo que los otros, que es exactamente lo que pasa con "Informacion general"
 * al lado de "Pruebas".
 *
 * Al lado, cada paso ocupa lo que necesita, el conector queda centrado solo con
 * `items-center`, y no hay ni un pixel puesto a ojo. Es tambien la forma en la
 * que se lee un camino: se sigue con el dedo de izquierda a derecha.
 *
 * EL TRAMO ES LA BARRA DE PROGRESO. Cuatro cajas sueltas son cuatro destinos
 * independientes; unidas por una linea que se pinta a medida que se avanza, son
 * un camino, y contestan "¿cuanto me falta?" sin que nadie lo pregunte.
 *
 * Cada paso tiene TRES estados:
 *
 *   hecho     circulo lleno con tilde, y es un LINK — volver a corregir algo es
 *             lo normal, no una excepcion.
 *   actual    circulo con borde de color y titulo en blanco.
 *   pendiente apagado y sin link: saltearse la ficha deja una competencia sin
 *             nombre ni fecha.
 *
 * Se pinta desde la lista de pasos, asi que agregar uno es agregar una entrada.
 *
 * EL CAMINO OCUPA TODO EL ANCHO DISPONIBLE, NO SOLO LO QUE SUS PASTILLAS PESAN
 *
 * Antes el `<ol>` era `min-w-max` y los tramos entre circulos tenian un ancho
 * fijo (`w-6`): con cuatro o cinco pasos el conjunto quedaba mas angosto que el
 * contenedor y se veia pegado a la izquierda, con un tramo final de espacio
 * vacio que no significaba nada. Ese diseño arrastraba ademas la solucion de
 * un problema que ya no existe: con CINCO pasos y titulos largos ("Informacion
 * general" junto a "Pruebas") la fila se pasaba del `max-w-4xl` del asistente y
 * habia que dejarla desplazable. Con los CUATRO pasos actuales eso no vuelve a
 * pasar, asi que el diseño se invirtio: cada paso es `flex-1` y el tramo que lo
 * sigue es `flex-1` tambien, asi que estiran para ocupar exactamente el ancho
 * que haya —angosto en un celular, ancho en un escritorio— en vez de encogerse
 * a su contenido y dejar un resto sin usar. Ya no hace falta desplazamiento.
 *
 *   - en escritorio los cuatro titulos completos entran con los tramos
 *     estirados entre ellos, como una barra de progreso de punta a punta;
 *   - abajo de `md` solo el paso ACTUAL muestra su titulo, asi los circulos no
 *     se aplastan entre si en una pantalla angosta. El titulo del paso en el
 *     que uno esta igual aparece completo debajo del indicador.
 */
export function PasosDelAsistente({
  actual,
  eventId,
}: {
  actual: string;
  /** null mientras la competencia todavia no existe. */
  eventId: string | null;
}) {
  const indiceActual = indiceDelPaso(actual);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
        Paso {indiceActual + 1} de {PASOS.length}
      </p>

      <nav aria-label="Pasos">
        <ol className="flex w-full items-center">
          {PASOS.map((paso, i) => {
            const hecho = i < indiceActual;
            const esActual = i === indiceActual;
            const navegable = hecho && eventId !== null;

            const cuerpo = (
              <>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    hecho
                      ? "bg-lime-400 text-lime-950"
                      : esActual
                        ? "bg-lime-400/15 text-lime-300 ring-2 ring-lime-400"
                        : "bg-neutral-900 text-neutral-600 ring-1 ring-neutral-800"
                  }`}
                >
                  {hecho ? (
                    <Icono nombre="tilde" className="h-3.5 w-3.5" grosor={3} />
                  ) : (
                    i + 1
                  )}
                </span>
                {/* El icono es `aria-hidden` —acompaña a un titulo que ya
                    nombra el paso— asi que el "ya esta hecho" hay que decirlo
                    aparte: sin esto, un lector de pantalla anuncia los cinco
                    pasos igual y no queda ninguno distinguible del otro. */}
                {hecho && <span className="sr-only">Completado: </span>}
                <span
                  className={`whitespace-nowrap ${esActual ? "" : "hidden md:inline"}`}
                >
                  {paso.titulo}
                </span>
              </>
            );

            // El relleno derecho solo hace falta cuando hay titulo al lado: sin
            // el, la pastilla del paso queda redonda alrededor del circulo en
            // vez de arrastrar un hueco.
            const clases = `flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 text-sm font-medium transition-colors ${
              esActual ? "pr-3.5" : "pr-1.5 md:pr-3.5"
            } ${
              esActual
                ? "bg-neutral-900 text-neutral-50"
                : hecho
                  ? "text-neutral-300 hover:bg-neutral-900"
                  : "text-neutral-600"
            }`;

            return (
              <li key={paso.slug} className="flex flex-1 items-center last:flex-none">
                {navegable ? (
                  <Link
                    href={`/panel/asistente/${eventId}/${paso.slug}`}
                    className={clases}
                    aria-current={esActual ? "step" : undefined}
                  >
                    {cuerpo}
                  </Link>
                ) : (
                  <span
                    className={clases}
                    aria-current={esActual ? "step" : undefined}
                  >
                    {cuerpo}
                  </span>
                )}

                {/* El tramo hacia el siguiente ESTIRA (`flex-1`) para llenar
                    lo que sobre entre una pastilla y la otra: es lo que hace
                    que el camino ocupe el ancho disponible en vez de quedar
                    encogido a la izquierda. Se pinta cuando el paso ya se
                    recorrio: la linea entera es la barra de progreso. */}
                {i < PASOS.length - 1 && (
                  <span
                    aria-hidden
                    className={`h-px min-w-4 flex-1 md:min-w-6 ${hecho ? "bg-lime-400" : "bg-neutral-800"}`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
