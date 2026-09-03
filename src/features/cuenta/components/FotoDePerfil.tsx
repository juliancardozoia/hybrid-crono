"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { guardarAvatar } from "../actions";
import { useCargaMientras } from "@/shared/components/Carga";

const MAXIMO_BYTES = 2 * 1024 * 1024;
const TIPOS = ["image/jpeg", "image/png", "image/webp"];

/**
 * La foto de perfil.
 *
 * EL ARCHIVO VA DIRECTO DEL NAVEGADOR A STORAGE, no a una server action. Subirlo
 * a nuestro servidor para que este lo reenvie significa cargar la imagen entera
 * en memoria, pagar el doble de trafico y chocar contra un limite de tamaño de
 * payload que no controlamos. El navegador ya tiene la sesion del usuario, y la
 * politica del bucket exige que la carpeta se llame como su uuid.
 *
 * LA RUTA LLEVA UNA MARCA DE TIEMPO. Con un nombre fijo, el CDN sigue sirviendo
 * la foto vieja despues de cambiarla: el usuario sube una nueva, ve la anterior
 * y vuelve a subirla. Un nombre distinto cada vez hace que no haya cache que
 * invalidar.
 *
 * Se valida tipo y tamaño ANTES de subir. El bucket tambien lo hace —es la
 * barrera de verdad— pero un rechazo del servidor despues de esperar la subida
 * de una foto de ocho megas es una espera regalada.
 */
export function FotoDePerfil({
  url,
  nombre,
  userId,
}: {
  url: string | null;
  nombre: string;
  userId: string;
}) {
  const [actual, setActual] = useState(url);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  useCargaMientras(subiendo, "Subiendo la foto…");

  async function elegida(archivo: File) {
    setError(null);

    if (!TIPOS.includes(archivo.type)) {
      setError("Tiene que ser una imagen JPG, PNG o WebP.");
      return;
    }
    if (archivo.size > MAXIMO_BYTES) {
      setError("La imagen no puede pesar más de 2 MB.");
      return;
    }

    setSubiendo(true);
    try {
      const supabase = createClient();
      const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const ruta = `${userId}/${Date.now()}.${extension}`;

      const { error: fallo } = await supabase.storage
        .from("avatars")
        .upload(ruta, archivo, { contentType: archivo.type });

      if (fallo) {
        setError("No se pudo subir la foto. Intenta de nuevo.");
        return;
      }

      const { data } = supabase.storage.from("avatars").getPublicUrl(ruta);
      const publica = data.publicUrl;

      // Se muestra ya, sin esperar a que el servidor confirme: el archivo ya
      // esta arriba y el usuario acaba de verlo suceder.
      setActual(publica);
      startTransition(async () => {
        const res = await guardarAvatar(publica);
        if (res.error) setError(res.error);
      });
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="flex items-center gap-5">
      <div className="relative">
        {actual ? (
          // Imagen de Supabase Storage: <img> y no next/image, que exigiria
          // declarar el host en la configuracion.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={actual}
            alt=""
            className="h-20 w-20 rounded-2xl border border-neutral-800 object-cover"
          />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900 text-2xl font-black text-neutral-600">
            {(nombre[0] ?? "?").toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <input
          ref={input}
          type="file"
          accept={TIPOS.join(",")}
          className="hidden"
          onChange={(e) => {
            const archivo = e.target.files?.[0];
            if (archivo) void elegida(archivo);
            // Se limpia para que elegir el MISMO archivo otra vez vuelva a
            // disparar el evento: sin esto, reintentar tras un error no hace
            // nada y parece que el botón está roto.
            e.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={subiendo}
          className="w-fit rounded-xl border border-neutral-700 px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-900 disabled:opacity-60"
        >
          {subiendo ? "Subiendo…" : actual ? "Cambiar foto" : "Subir foto"}
        </button>

        <p className="text-xs text-neutral-600">JPG, PNG o WebP. Hasta 2 MB.</p>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
