/**
 * Los pocos iconos que usa el portal publico.
 *
 * POR QUE INLINE Y NO UNA LIBRERIA
 *
 * El proyecto no usa librerias de UI, y una de iconos traeria mil quinientos
 * para usar seis. Estos son trazos de `stroke` de 24×24 sobre la misma rejilla,
 * asi que se ven de la misma familia y heredan el color del texto con
 * `currentColor` — un `<img>` no lo haria y habria que mantener una version por
 * color.
 *
 * Cada uno lleva `aria-hidden`: acompañan a un texto que ya dice lo mismo. Un
 * lector de pantalla que anuncie "icono de calendario" antes de la fecha solo
 * agrega ruido. El unico que se usa solo —Instagram— lleva su `aria-label` en
 * el enlace que lo contiene.
 */

const TRAZOS: Record<string, React.ReactNode> = {
  calendario: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  reloj: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  lugar: (
    <>
      <path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  inscripcion: (
    <>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M9 13l2 2 4-4" />
    </>
  ),
  personas: (
    <>
      <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
    </>
  ),
  pesa: (
    <>
      <path d="M2 12h2M20 12h2M6.5 8v8M17.5 8v8M4.5 10v4M19.5 10v4M6.5 12h11" />
    </>
  ),
  documento: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  trofeo: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0Z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M12 14v3M9 20h6M10 17h4" />
    </>
  ),
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </>
  ),
  flecha: <path d="M9 6l6 6-6 6" />,
  // El tilde de "esto ya esta hecho". Dibujado sobre la misma rejilla de 24 y
  // no como el caracter "✓": ese lo resuelve cada sistema con su propia fuente
  // —en Windows sale mas fino y desalineado respecto a la linea base— y no se
  // puede engrosar ni centrar sin pelear con la tipografia.
  tilde: <path d="M5 12.5 10 17 19 7.5" />,
  copiar: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  // El generico de "mensaje", no el logo de WhatsApp: el proyecto no dibuja
  // logos de marca (ver Instagram, arriba) — el color verde y el link a
  // wa.me ya dicen de que se trata.
  whatsapp: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.32 7.6L4 20l1.06-4.5A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M8.5 10.5c.3 2.5 2.5 4.7 5 5" />
    </>
  ),
};

export type NombreDeIcono = keyof typeof TRAZOS;

export function Icono({
  nombre,
  className = "h-4 w-4",
  grosor = 1.8,
}: {
  nombre: NombreDeIcono;
  className?: string;
  /** Un icono chico dentro de una pastilla llena necesita mas trazo para
   *  pesar lo mismo que el texto que lo rodea. */
  grosor?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={grosor}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      {TRAZOS[nombre]}
    </svg>
  );
}
