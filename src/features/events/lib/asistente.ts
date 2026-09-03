/**
 * Los pasos del asistente de creacion de competencia.
 *
 * Es una LISTA DE DATOS y no un componente con ramas a proposito: agregar,
 * sacar o reordenar un paso es tocar este arreglo, y la navegacion, el indicador
 * de progreso y los botones de siguiente se acomodan solos. Ya se cobro dos
 * veces: cuando entro "documentos" en el medio, y cuando salieron categorias y
 * pruebas.
 *
 * QUE PASO ADENTRO Y QUE NO. El asistente arma la FICHA de la competencia: como
 * se llama, que papeles pide y como se cobra. Categorias y pruebas se fueron a
 * "Configuracion competencia" porque no son un tramite de una sentada: se
 * cargan, se corrigen y se vuelven a abrir durante semanas —una categoria nueva
 * en marzo, un WOD que cambia la vispera— y tenerlas como paso 3 y 4 obligaba a
 * recorrer un asistente entero para tocar un peso.
 *
 * El borrador vive en la base, no en memoria: cada paso guarda de verdad y el
 * evento queda en `draft` hasta que el organizador lo cierra. Un asistente que
 * acumula estado en el cliente pierde todo con un refresh, y configurar una
 * competencia lleva mas de una sentada.
 */

export interface PasoDelAsistente {
  slug: string;
  titulo: string;
  /** Lo que el organizador tiene que entender antes de completarlo. */
  ayuda: string;
  /** Se puede terminar el asistente sin haberlo completado. */
  opcional?: boolean;
}

export const PASOS: readonly PasoDelAsistente[] = [
  {
    slug: "general",
    titulo: "Información general",
    ayuda: "Cómo se llama, cuándo y dónde.",
  },
  {
    slug: "documentos",
    titulo: "Documentos",
    ayuda:
      "El reglamento, el plano del recinto y los términos que hay que aceptar para inscribirse.",
    opcional: true,
  },
  {
    slug: "inscripcion",
    titulo: "Inscripción",
    ayuda: "Cómo se cobra, cuánto sale cada categoría y qué descuentos hay.",
    opcional: true,
  },
  {
    slug: "resumen",
    titulo: "Resumen",
    ayuda: "Lo que se cargó en cada paso del asistente.",
  },
];


export function indiceDelPaso(slug: string): number {
  const indice = PASOS.findIndex((p) => p.slug === slug);
  return indice === -1 ? 0 : indice;
}

export function pasoSiguiente(slug: string): PasoDelAsistente | null {
  return PASOS[indiceDelPaso(slug) + 1] ?? null;
}

export function pasoAnterior(slug: string): PasoDelAsistente | null {
  const indice = indiceDelPaso(slug);
  return indice > 0 ? PASOS[indice - 1] : null;
}
