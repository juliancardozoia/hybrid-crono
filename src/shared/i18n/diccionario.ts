import { es, type ClaveDeTexto, type Diccionario } from "./es";
import { pt } from "./pt";
import { en } from "./en";
import { IDIOMA_POR_DEFECTO, type Idioma } from "./idiomas";

export type { ClaveDeTexto, Diccionario };

const DICCIONARIOS: Record<Idioma, Diccionario> = { es, pt, en };

/** La funcion que traduce. Se le pasa a los componentes ya atada a un idioma. */
export type Traducir = (clave: ClaveDeTexto, vars?: Record<string, string | number>) => string;

/**
 * Arma el traductor de un idioma.
 *
 * Las variables se interpolan con `{nombre}` y NO concatenando trozos. Un
 * "Cierran en " + n + " días" obliga a cada idioma a poner el numero en el
 * mismo lugar, y en ingles ("Closes in 5 days") o en portugues el orden y las
 * preposiciones cambian. Con la plantilla completa, cada idioma acomoda la
 * frase como le corresponde.
 *
 * Si falta una clave devuelve el texto en español en vez de la clave cruda: un
 * "evento.cierran" en la pantalla es peor que la misma frase en otro idioma.
 * En la practica no deberia pasar —los tres diccionarios se tipan contra el
 * mismo `Diccionario`— pero un diccionario cargado a mano puede llegar
 * incompleto.
 */
export function crearTraductor(idioma: Idioma): Traducir {
  const dic = DICCIONARIOS[idioma] ?? DICCIONARIOS[IDIOMA_POR_DEFECTO];

  return (clave, vars) => {
    const plantilla = dic[clave] ?? es[clave] ?? clave;
    if (!vars) return plantilla;

    return plantilla.replace(/\{(\w+)\}/g, (crudo, nombre) =>
      nombre in vars ? String(vars[nombre]) : crudo,
    );
  };
}

/**
 * El locale para `Intl`, que no es lo mismo que nuestro codigo de idioma.
 *
 * `pt` a secas le da a `Intl` el portugues europeo, y "1.º de março" no es como
 * escribe una fecha un brasileño.
 */
export function localeDeIntl(idioma: Idioma): string {
  return { es: "es-419", pt: "pt-BR", en: "en-US" }[idioma];
}
