"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Las secciones de configuracion siguen el orden en que hay que completarlas. */
interface Seccion {
  slug: string;
  label: string;
  /** El juez no necesita ver la torre de control ni la verificacion. */
  soloVerificadores?: boolean;
}

const SECCIONES: Seccion[] = [
  { slug: "", label: "Resumen" },
  { slug: "circuito", label: "Circuito" },
  { slug: "divisiones", label: "Divisiones" },
  { slug: "penalizaciones", label: "Penalizaciones" },
  { slug: "atletas", label: "Atletas" },
  { slug: "heats", label: "Heats" },
  { slug: "control", label: "Control", soloVerificadores: true },
  { slug: "resultados", label: "Resultados", soloVerificadores: true },
  { slug: "qr", label: "QR" },
];

export function EventTabs({
  eventId,
  canManage,
  canVerify,
}: {
  eventId: string;
  canManage: boolean;
  canVerify: boolean;
}) {
  const pathname = usePathname();
  const base = `/panel/eventos/${eventId}`;

  // Un juez solo necesita ver sus heats: el resto de la configuracion no le
  // sirve y le agrega ruido a una pantalla que va a usar apurado.
  const visibles = canManage
    ? SECCIONES
    : canVerify
      ? SECCIONES.filter((s) => ["heats", "control", "resultados"].includes(s.slug))
      : SECCIONES.filter((s) => s.slug === "heats");

  return (
    <nav className="tabs-scroll mt-5 flex gap-1 border-b border-neutral-800">
      {visibles.map((seccion) => {
        const href = seccion.slug ? `${base}/${seccion.slug}` : base;
        const activo = seccion.slug
          ? pathname.startsWith(href)
          : pathname === base;

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
