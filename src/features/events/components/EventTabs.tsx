"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { EventFormat } from "@/lib/supabase/types";

/**
 * Una sola barra: Resumen, Divisiones, Circuito o Workouts, Atletas, Heats,
 * Penalizaciones.
 *
 * Hubo una version con DOS barras —esta con lo de produccion, y `ConfigTabs`
 * al lado con Circuito/Divisiones/Atletas/Penalizaciones— y se volvio para
 * atras: la separacion agregaba una fila mas a la pantalla y una regla extra
 * para acordarse ("¿esta pantalla esta en la barra de arriba o en la de
 * abajo?"). Todo entra en una sola fila sin problema.
 *
 * **"Cargar" se saco.** La carga manual de resultados es un concepto de
 * CrossFit —scores que alguien tipea— y una carrera hibrida no tiene nada que
 * cargar a mano: el tiempo sale de cronometrar. Ofrecerla en una carrera
 * hibrida invitaba a un alta manual que este formato no usa.
 *
 * **Circuito y Workouts son EXCLUYENTES segun el formato**, igual que en todos
 * lados: una carrera hibrida nunca ve "Workouts" y un CrossFit nunca ve
 * "Circuito".
 *
 * **Fuera de `canManage` la barra se reduce a "Heats".** Divisiones, Circuito,
 * Atletas y Penalizaciones son configuracion de la competencia: un juez o un
 * verificador no tiene nada que hacer ahi, y mostrarselas es superficie de mas
 * en una pantalla que van a usar apurados el dia del evento.
 *
 * **"Config Competencia" (barra lateral) y "Resumen" (esta pestaña) son la
 * MISMA pantalla**, `/panel/eventos/[id]` sin sufijo. No hay una ruta
 * `/configuracion` separada.
 *
 * **QR esta OCULTO por ahora, no eliminado.** La ruta y la pantalla siguen
 * existiendo; solo se saco la pestaña de esta lista. Volver a mostrarla es
 * agregar la linea de vuelta.
 *
 * Jueces, colaboradores, control, inscripciones, cronograma, leaderboard y
 * verificacion siguen sin pestaña: son ajustes especificos a los que se llega
 * por la barra lateral, y ofrecer ahi arriba un atajo de vuelta invita a
 * abandonar lo que se estaba configurando. Se esconden solas segun la ruta
 * (`SIN_PESTANAS`) y no por una prop.
 */

interface Seccion {
  slug: string;
  label: string;
}

/** Rutas que NO muestran esta barra: se llega por la barra lateral. */
const SIN_PESTANAS = [
  "/jueces",
  "/colaboradores",
  "/control",
  "/inscripciones",
  "/cronograma",
  "/leaderboard",
  "/verificacion",
];

function secciones(esHibrida: boolean): Seccion[] {
  return [
    { slug: "", label: "Resumen" },
    { slug: "divisiones", label: "Categorías" },
    esHibrida ? { slug: "circuito", label: "Circuito" } : { slug: "pruebas", label: "Workouts" },
    { slug: "atletas", label: "Atletas" },
    { slug: "heats", label: "Heats" },
    { slug: "penalizaciones", label: "Penalizaciones" },
  ];
}

export function EventTabs({
  eventId,
  formato,
  canManage,
}: {
  eventId: string;
  formato: EventFormat;
  canManage: boolean;
}) {
  const pathname = usePathname();
  const base = `/panel/eventos/${eventId}`;

  if (SIN_PESTANAS.some((r) => pathname.startsWith(`${base}${r}`))) return null;

  const SECCIONES = secciones(formato !== "crossfit");

  // Divisiones, Circuito, Atletas y Penalizaciones son configuracion: un juez
  // o un verificador —sin permiso de gestion— solo necesita ver sus heats.
  const visibles = canManage ? SECCIONES : SECCIONES.filter((s) => s.slug === "heats");

  if (visibles.length === 0) return null;

  return (
    <nav className="tabs-scroll mt-5 flex gap-1 border-b border-neutral-800">
      {visibles.map((seccion) => {
        const href = seccion.slug ? `${base}/${seccion.slug}` : base;
        const activo = seccion.slug ? pathname.startsWith(href) : pathname === base;

        return (
          <Link
            key={seccion.slug}
            href={href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              activo
                ? "border-lime-400 font-medium text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {seccion.label}
          </Link>
        );
      })}
    </nav>
  );
}
