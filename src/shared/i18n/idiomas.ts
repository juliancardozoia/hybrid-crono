/**
 * Los idiomas de la plataforma.
 *
 * POR QUE COOKIE Y NO UN SEGMENTO `/[idioma]/` EN LA RUTA
 *
 * Lo correcto para SEO es `/es/...`, `/pt/...`, `/en/...`: cada idioma con su
 * URL, indexable y compartible. Pero eso obliga a meter TODA la app bajo un
 * segmento dinamico, y `/juez/carril` tiene que seguir siendo estatica —es lo
 * que permite que el service worker la sirva del cache cuando el juez reinicia
 * el celular sin señal. Una ruta dentro de `[idioma]` se renderiza en el
 * servidor y deja de precachearse: se cambiaria posicionamiento por la garantia
 * central del producto.
 *
 * Asi que el idioma vive en una cookie, con el `Accept-Language` del navegador
 * como primera respuesta razonable. Cuando el portal publico justifique el
 * trabajo, lo correcto es moverlo a la URL dejando `/juez` FUERA del segmento.
 */

export const IDIOMAS = [
  { codigo: "es", nombre: "Español", corto: "ES" },
  { codigo: "pt", nombre: "Português", corto: "PT" },
  { codigo: "en", nombre: "English", corto: "EN" },
] as const;

export type Idioma = (typeof IDIOMAS)[number]["codigo"];

export const IDIOMA_POR_DEFECTO: Idioma = "es";

export const COOKIE_DE_IDIOMA = "idioma";

/** Un año: la eleccion de idioma no es algo que se vuelva a preguntar. */
export const DURACION_COOKIE = 60 * 60 * 24 * 365;

export function esIdioma(valor: string | undefined | null): valor is Idioma {
  return IDIOMAS.some((i) => i.codigo === valor);
}

/**
 * El mejor idioma segun la cabecera `Accept-Language`.
 *
 * La cabecera viene como `pt-BR,pt;q=0.9,en;q=0.8`: pares de etiqueta y peso,
 * en cualquier orden. Se ordena por peso y se toma el primero que hablamos.
 * Alcanza con los dos primeros caracteres: a `pt-BR` y `pt-PT` les damos el
 * mismo portugues, y a `en-US` y `en-GB` el mismo ingles.
 */
export function idiomaDeCabecera(cabecera: string | null): Idioma | null {
  if (!cabecera) return null;

  const preferencias = cabecera
    .split(",")
    .map((parte) => {
      const [etiqueta, ...resto] = parte.trim().split(";");
      const q = resto.find((r) => r.trim().startsWith("q="));
      const peso = q ? Number(q.split("=")[1]) : 1;
      return { base: etiqueta.trim().slice(0, 2).toLowerCase(), peso: Number.isFinite(peso) ? peso : 0 };
    })
    .sort((a, b) => b.peso - a.peso);

  for (const p of preferencias) {
    if (esIdioma(p.base)) return p.base;
  }
  return null;
}
