"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Una caja a la que se le arrastra un archivo.
 *
 * SE PUEDE ARRASTRAR **Y** HACER CLICK. Solo arrastrar deja afuera a quien esta
 * en un celular —donde no hay nada que arrastrar— y a quien navega con teclado.
 * La caja entera es un boton, asi que el click funciona en todos lados y el
 * arrastre es el atajo de quien esta en un escritorio con la carpeta abierta.
 *
 * LOS LIMITES SE DICEN ANTES Y SE VALIDAN ANTES. El bucket tambien los aplica
 * —esa es la barrera de verdad— pero enterarse de que la foto pesa demasiado
 * DESPUES de esperar la subida de ocho megas es una espera regalada. Y un
 * recuadro que no dice que acepta obliga a probar.
 *
 * EL ARCHIVO VA DIRECTO DEL NAVEGADOR A STORAGE. Reenviarlo por una server
 * action significa cargarlo entero en memoria del servidor, pagar el doble de
 * trafico y chocar contra un limite de payload que no controlamos.
 *
 * LA RUTA LLEVA MARCA DE TIEMPO: con un nombre fijo el CDN sigue sirviendo el
 * archivo viejo, y quien sube un logo nuevo ve el anterior y lo vuelve a subir.
 */
export function ZonaDeArchivo({
  carpeta,
  tipos,
  maximoMb,
  ayuda,
  etiqueta,
  onSubido,
  bucket = "eventos",
  className = "",
}: {
  /** Prefijo de la ruta dentro del bucket. La politica lo usa para decidir. */
  carpeta: string;
  tipos: string[];
  maximoMb: number;
  ayuda: string;
  etiqueta: string;
  onSubido: (url: string, nombre: string) => void | Promise<void>;
  bucket?: string;
  /** Para alinear la caja con lo que tenga al lado. */
  className?: string;
}) {
  const [encima, setEncima] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function subir(archivo: File) {
    setError(null);

    if (!tipos.includes(archivo.type)) {
      setError("Ese tipo de archivo no se acepta.");
      return;
    }
    if (archivo.size > maximoMb * 1024 * 1024) {
      setError(`El archivo no puede pesar más de ${maximoMb} MB.`);
      return;
    }

    setSubiendo(true);
    try {
      const supabase = createClient();
      // El nombre original se sanea: un archivo llamado "Reglamento (v2).pdf"
      // rompe la ruta y deja una URL que no se puede abrir.
      const limpio = archivo.name.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
      const ruta = `${carpeta}/${Date.now()}-${limpio}`;

      const { error: fallo } = await supabase.storage
        .from(bucket)
        .upload(ruta, archivo, { contentType: archivo.type });

      if (fallo) {
        setError("No se pudo subir. Intenta de nuevo.");
        return;
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(ruta);
      await onSubido(data.publicUrl, archivo.name);
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        accept={tipos.join(",")}
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) void subir(archivo);
          // Se limpia para que elegir el MISMO archivo otra vez vuelva a
          // disparar el evento: sin esto, reintentar tras un error no hace nada
          // y el botón parece roto.
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setEncima(true);
        }}
        onDragLeave={() => setEncima(false)}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          const archivo = e.dataTransfer.files?.[0];
          if (archivo) void subir(archivo);
        }}
        disabled={subiendo}
        className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors disabled:opacity-60 ${className} ${
          encima
            ? "border-lime-400 bg-lime-400/5"
            : "border-neutral-700 hover:border-neutral-600 hover:bg-neutral-900/40"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-neutral-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 16V4M8 8l4-4 4 4" />
          <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>

        <span className="text-sm font-semibold">
          {subiendo ? "Subiendo…" : encima ? "Suelta el archivo" : etiqueta}
        </span>
        <span className="text-xs text-neutral-500">{ayuda}</span>
      </button>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
