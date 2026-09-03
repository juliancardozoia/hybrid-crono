"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icono, type NombreDeIcono } from "@/shared/components/Icono";

/**
 * Las pestañas de la ficha.
 *
 * SON RUTAS, NO ESTADO. Cada pestaña es una URL propia
 * (`/eventos/[slug]/cronograma`), asi que se comparte —"mirá el cronograma"—,
 * el boton de atras funciona, y cada pestaña se renderiza entera en el servidor
 * y es indexable. Con estado en el cliente nada de eso pasa, y ademas habria que
 * bajar los cuatro contenidos aunque se mire uno.
 *
 * El unico trabajo del cliente es SABER CUAL ESTA ACTIVA, que necesita
 * `usePathname`. Es lo minimo que justifica el `"use client"`.
 *
 * SE VE COMO UN CONTROL DE PESTAÑAS, NO COMO CUATRO BOTONES. La diferencia esta
 * en el indicador: una pastilla rellena es un boton —invita a "hacer" algo— y
 * cuatro pastillas juntas compiten entre si. Una pestaña se marca con un SUBRAYADO
 * y comparte una linea con las demas: la linea dice "esto es un mismo grupo, y
 * este es el que estas viendo".
 *
 * La linea de guia es tenue y llega solo hasta donde llegan las pestañas, no de
 * borde a borde: una regla a todo el ancho parte la pagina en dos y hace parecer
 * que las pestañas pertenecen al encabezado y no al contenido que muestran.
 */

export interface Pestana {
  href: string;
  label: string;
  icono: NombreDeIcono;
}

export function PestanasDelEvento({ pestanas }: { pestanas: Pestana[] }) {
  const pathname = usePathname();

  if (pestanas.length < 2) return null;

  return (
    // Pegada bajo el encabezado del sitio, que mide 57px. Al hacer scroll por
    // un cronograma largo, cambiar de pestaña sigue estando a un click.
    <nav className="sticky top-[57px] z-10 bg-neutral-950/95 backdrop-blur">
      <div className="mx-auto w-full max-w-5xl px-4">
        <div className="tabs-scroll flex gap-6 border-b border-neutral-800/80">
        {pestanas.map((p) => {
          // La primera pestaña es la ficha misma: comparar por prefijo la
          // marcaria activa en todas las demas.
          const activa =
            pathname === p.href || (p.href !== pestanas[0].href && pathname.startsWith(p.href));

          return (
            <Link
              key={p.href}
              href={p.href}
              aria-current={activa ? "page" : undefined}
              className={`-mb-px flex items-center gap-2 border-b-2 px-1 py-3.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                activa
                  ? "border-lime-400 text-neutral-50"
                  : "border-transparent text-neutral-500 hover:border-neutral-700 hover:text-neutral-200"
              }`}
            >
              <Icono nombre={p.icono} className="h-4 w-4" />
              {p.label}
            </Link>
          );
          })}
        </div>
      </div>
    </nav>
  );
}
