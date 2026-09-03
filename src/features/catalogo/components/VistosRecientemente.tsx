"use client";

import { useEffect, useState } from "react";
import { TarjetaDeEvento } from "./TarjetaDeEvento";
import type { FichaDeCatalogo } from "../queries";
import type { Idioma } from "@/shared/i18n/idiomas";

/**
 * Las competencias que este navegador miró.
 *
 * Vive en localStorage y no en la base a proposito: la mayoria de la gente
 * navega el catalogo sin cuenta, asi que no hay a quien atarle un historial. Y
 * aunque la hubiera, "que miré" es un dato que no necesitamos guardar en
 * ningun servidor para prestar este servicio.
 *
 * Se renderiza en el cliente y despues del primer pintado, asi que no retrasa
 * el catalogo ni rompe el HTML del servidor.
 */

const CLAVE = "hybrid-crono.vistos";
const MAXIMO = 8;

function leerSlugs(): string[] {
  try {
    const crudo = localStorage.getItem(CLAVE);
    const lista = crudo ? (JSON.parse(crudo) as unknown) : [];
    return Array.isArray(lista) ? lista.filter((s): s is string => typeof s === "string") : [];
  } catch {
    // Modo privado, almacenamiento lleno o JSON corrupto: sin historial y ya.
    return [];
  }
}

/** Deja constancia de que este navegador abrió la ficha. */
export function RegistrarVisita({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      const previos = leerSlugs().filter((s) => s !== slug);
      localStorage.setItem(CLAVE, JSON.stringify([slug, ...previos].slice(0, MAXIMO)));
    } catch {
      // Si no se puede guardar, no pasa nada: es una comodidad, no un dato.
    }
  }, [slug]);

  return null;
}

export function VistosRecientemente({
  buscar,
  idioma,
  titulo,
}: {
  /** Resuelve las fichas de esos slugs. Lo inyecta la pagina como server action. */
  buscar: (slugs: string[]) => Promise<FichaDeCatalogo[]>;
  idioma: Idioma;
  titulo: string;
}) {
  const [eventos, setEventos] = useState<FichaDeCatalogo[]>([]);

  useEffect(() => {
    const slugs = leerSlugs();
    if (slugs.length === 0) return;

    let cancelado = false;
    void buscar(slugs).then((filas) => {
      if (cancelado) return;
      // La consulta devuelve por fecha; aquí importa el orden en que se miraron.
      const porSlug = new Map(filas.map((f) => [f.slug, f]));
      setEventos(slugs.flatMap((s) => (porSlug.has(s) ? [porSlug.get(s)!] : [])));
    });

    return () => {
      cancelado = true;
    };
  }, [buscar]);

  if (eventos.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {eventos.map((evento) => (
          <TarjetaDeEvento key={evento.slug} evento={evento} idioma={idioma} />
        ))}
      </div>
    </section>
  );
}
