"use client";

import { useState } from "react";
import { nombreDePais } from "@/shared/utils/paises";

/**
 * La bandera de un pais, a partir de su codigo ISO.
 *
 * POR QUE NO EMOJI
 *
 * `🇨🇴` seria una linea de codigo y cero peso. Pero **Windows no trae la fuente
 * de banderas**: en Chrome y Edge sobre Windows el emoji se dibuja como las dos
 * letras "CO" en una cajita. Es una parte enorme del publico de una plataforma
 * de eventos, asi que el emoji queda descartado por mas comodo que sea.
 *
 * POR QUE UNA IMAGEN Y NO SVG PROPIO
 *
 * Dibujar a mano veinticuatro banderas es mucho SVG, y una bandera mal dibujada
 * ofende mas que no ponerla: la de Chile lleva estrella, la de Brasil un globo
 * con una frase, la de Mexico un aguila. Se sirven de flagcdn, que es el mismo
 * camino que ya toman las portadas de los eventos: `<img>` a un dominio
 * arbitrario, sin `next/image`, que exigiria declarar cada host.
 *
 * SI LA IMAGEN NO CARGA, NO QUEDA UN HUECO. Cae al codigo del pais en una
 * cajita, que sigue diciendo de donde es el evento. Sin este respaldo, una
 * tarjeta sin conexion al CDN se ve rota.
 */
export function Bandera({
  codigo,
  className = "",
  titulo,
}: {
  codigo: string | null;
  className?: string;
  /** Se muestra al pasar el mouse. Por defecto, el nombre del país. */
  titulo?: string;
}) {
  const [falló, setFalló] = useState(false);
  if (!codigo) return null;

  const iso = codigo.toLowerCase();
  const nombre = titulo ?? nombreDePais(codigo) ?? codigo;

  if (falló) {
    return (
      <span
        title={nombre}
        className={`inline-flex items-center justify-center rounded-[3px] bg-neutral-800 px-1 font-mono text-[10px] font-bold text-neutral-300 ${className}`}
      >
        {codigo.toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${iso}.png`}
      srcSet={`https://flagcdn.com/w80/${iso}.png 2x`}
      alt={nombre}
      title={nombre}
      loading="lazy"
      onError={() => setFalló(true)}
      className={`rounded-[3px] object-cover ${className}`}
    />
  );
}
