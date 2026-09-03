"use client";

import { useState } from "react";
import { ZonaDeArchivo } from "@/shared/components/ZonaDeArchivo";

const TIPOS = ["image/jpeg", "image/png", "image/webp"];

/**
 * El logo de la competencia.
 *
 * SE SUBE, NO SE PEGA UNA URL. Antes habia un campo de texto pidiendo un enlace
 * directo a la imagen: funciona para quien ya tiene su afiche subido a algun
 * lado y sabe sacar la URL cruda, o sea casi nadie. Lo normal es tener el JPG en
 * el celular.
 *
 * LA VISTA PREVIA ES CUADRADA, y no es capricho: es exactamente el recorte que
 * va a sufrir en la tarjeta del catalogo. Mostrarla apaisada aqui y cuadrada
 * alla es dejar que el organizador descubra despues que su afiche perdio el
 * nombre del evento. El `object-cover` recorta igual que la tarjeta, asi que lo
 * que se ve aqui es lo que se va a ver alla.
 *
 * La URL viaja en un input oculto porque el formulario de la ficha se envia
 * entero con una server action: subir la imagen no guarda el evento, solo deja
 * lista la referencia para cuando el organizador apriete Guardar.
 */
export function ImagenDelEvento({
  eventId,
  actual,
}: {
  /** null mientras la competencia todavia no existe: no hay carpeta donde subir. */
  eventId: string | null;
  actual: string | null;
}) {
  const [url, setUrl] = useState(actual ?? "");

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="logoUrl" value={url} />

      {/* Vista previa y caja de subida a la MISMA altura. Antes el cuadrado
          media 8rem y la caja punteada crecia con su contenido, asi que la fila
          quedaba con dos bloques de alturas distintas y un escalon a la derecha.
          Ahora los dos miden `h-40` y la caja se estira para acompañar. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        <div className="flex h-40 w-40 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
          {url ? (
            // Imagen de Storage: <img> y no next/image, que exigiria declarar el
            // host en la configuracion.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="px-4 text-center text-xs leading-relaxed text-neutral-600">
              Así se verá
              <br />
              en el catálogo
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {eventId ? (
            <ZonaDeArchivo
              carpeta={`${eventId}/logo`}
              tipos={TIPOS}
              maximoMb={5}
              etiqueta="Arrastra el afiche o haz clic"
              ayuda="JPG, PNG o WebP · hasta 5 MB · cuadrado (1:1)"
              onSubido={(nueva) => setUrl(nueva)}
              className="h-40"
            />
          ) : (
            // Sin evento no hay carpeta donde subir, y la politica del bucket se
            // apoya justamente en el id de la carpeta.
            <p className="flex h-40 items-center justify-center rounded-2xl border-2 border-dashed border-neutral-800 px-6 text-center text-sm text-neutral-500">
              Podrás subir el afiche apenas guardes este primer paso.
            </p>
          )}

          {url && (
            <button
              type="button"
              onClick={() => setUrl("")}
              className="self-start text-xs text-neutral-500 hover:text-red-400"
            >
              Quitar imagen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
