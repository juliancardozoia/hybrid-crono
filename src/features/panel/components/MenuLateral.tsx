"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icono, type NombreDeIcono } from "@/shared/components/Icono";
import { SelectorDeIdioma } from "@/shared/components/SelectorDeIdioma";
import { MenuDeCuenta } from "@/features/catalogo/components/MenuDeCuenta";
import type { Idioma } from "@/shared/i18n/idiomas";
import type { EventStatus } from "@/lib/supabase/types";

/**
 * El menu lateral del panel de organizador.
 *
 * POR QUE UNA BARRA LATERAL Y NO UN ENCABEZADO CON LINKS
 *
 * El panel es un espacio de trabajo, no una pagina que se visita: alguien
 * configurando una competencia salta veinte veces entre categorias, pruebas,
 * atletas y heats. Con los destinos en el encabezado, cada salto obliga a volver
 * arriba y leer una fila horizontal; en una barra lateral estan siempre en el
 * mismo sitio y el ojo los encuentra sin buscar.
 *
 * LA BARRA CAMBIA SEGUN DONDE SE ESTE
 *
 * Fuera de una competencia muestra lo de la cuenta. DENTRO de una competencia se
 * abre un bloque con esa competencia y sus secciones, y es lo que resuelve el
 * problema real: la ficha del evento tenia QUINCE pestañas en una sola fila
 * horizontal —de "Resumen" a "QR"— y encontrar algo era leerlas todas. Aca las
 * secciones estan una debajo de otra, agrupadas, y el nombre de la competencia
 * con su estado esta siempre a la vista para no perder de vista en cual se esta
 * trabajando.
 *
 * EN CELULAR SE CONVIERTE EN UN CAJON. Una barra fija se comeria media pantalla
 * de un telefono; se abre con el boton y se cierra al elegir.
 */

interface Enlace {
  href: string;
  label: string;
  icono: NombreDeIcono;
  /** Marca activa solo la coincidencia exacta. Para las raices. */
  exacto?: boolean;
}

// Sin "Jueces y equipo": se unifico con los Colaboradores del EVENTO. Habia dos
// puertas para dar acceso a alguien —los miembros de la organizacion, que abren
// TODOS los eventos presentes y futuros, y los colaboradores de uno solo— y
// tener las dos garantizaba que alguien usara la equivocada. La membresia de
// organizacion sigue existiendo para dueños y admins, y se llega desde la
// pantalla de colaboradores.
const CUENTA: Enlace[] = [
  { href: "/panel", label: "Mis Competencias", icono: "trofeo", exacto: true },
  { href: "/panel/organizacion/plan", label: "Plan", icono: "inscripcion" },
];

/** Las secciones de una competencia abierta. */
function seccionesDelEvento(id: string): {
  evento: Enlace[];
  administracion: Enlace[];
} {
  const base = `/panel/eventos/${id}`;
  return {
    evento: [
      // Lleva al ASISTENTE, no a un formulario suelto: la ficha, los
      // documentos y el cobro son un solo tramite con un orden, y tener las
      // mismas preguntas en dos pantallas garantiza que un dia difieran. El
      // href apunta al primer paso y el `startsWith` deja el enlace marcado
      // mientras se recorre.
      {
        href: `/panel/asistente/${id}/general`,
        label: "Información General",
        icono: "documento",
      },
      // Es la MISMA pantalla que la pestaña "Resumen" de arriba: el listado de
      // configuracion (Divisiones, Circuito/Workouts, Atletas, Heats,
      // Penalizaciones) y el estado de la competencia viven juntos en
      // `/panel/eventos/[id]`, sin sufijo. `exacto: true` es obligatorio: sin
      // el, `pathname.startsWith(base)` marcaria este enlace activo en
      // CUALQUIER pantalla del evento, porque `base` es prefijo de todas.
      { href: base, label: "Config Competencia", icono: "pesa", exacto: true },
      { href: `${base}/atletas`, label: "Registro Atletas", icono: "personas" },
      // Dos cosas distintas que estaban en una: el leaderboard es el RESULTADO
      // —la tabla que ve el publico— y la verificacion es el TRABAJO sobre los
      // datos: recalcular, revisar anomalias, publicar lo oficial. Se entraba a
      // "resultados" buscando la tabla y se encontraba una cola de anomalias.
      { href: `${base}/leaderboard`, label: "Leaderboard", icono: "trofeo" },
      {
        href: `${base}/verificacion`,
        label: "Verificación",
        icono: "documento",
      },
      {
        href: `${base}/inscripciones`,
        label: "Inscripciones",
        icono: "inscripcion",
      },
      { href: `${base}/cronograma`, label: "Cronograma", icono: "reloj" },
    ],
    administracion: [
      // Antes era una PESTAÑA de produccion (Resumen/Heats/Cargar/Control/QR).
      // Se monitorea la competencia igual que se administra: torre de control,
      // cola de anomalias, publicacion oficial — es trabajo de organizacion, no
      // algo que un juez con el celular en la mano necesite tener al lado de
      // "Heats" o "Cargar".
      { href: `${base}/control`, label: "Control", icono: "documento" },
      {
        href: `${base}/colaboradores`,
        label: "Colaboradores",
        icono: "personas",
      },
      // Debajo de colaboradores y aparte, porque son otra cosa: el colaborador
      // trabaja las semanas previas desde una computadora; el juez existe el DIA
      // del evento y solo califica.
      { href: `${base}/jueces`, label: "Jueces", icono: "reloj" },
    ],
  };
}

const ESTADO: Record<EventStatus, string> = {
  draft: "Borrador",
  ready: "Lista",
  live: "En vivo",
  verifying: "Verificando",
  published: "Publicada",
};

export interface EventoDelMenu {
  id: string;
  name: string;
  status: EventStatus;
}

export function MenuLateral({
  nombre,
  email,
  cerrarSesion,
  idioma,
  elegirIdioma,
  etiquetaIdioma,
  textosCuenta,
  eventos,
}: {
  nombre: string;
  email: string;
  cerrarSesion: () => Promise<void>;
  // El idioma se elige en TODA la app, no solo en el portal publico.
  idioma: Idioma;
  elegirIdioma: (codigo: string) => Promise<void>;
  etiquetaIdioma: string;
  // Los mismos textos que usa el encabezado publico: es el mismo MenuDeCuenta,
  // y un componente de cliente no puede resolver la traduccion por su cuenta.
  textosCuenta: {
    mi: string;
    panel: string;
    inscripciones: string;
    juzgar: string;
    salir: string;
  };
  /** Para poder mostrar el nombre y el estado de la competencia abierta. */
  eventos: EventoDelMenu[];
}) {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();

  // El id sale de la URL y el nombre de la lista que ya trae el layout. La
  // alternativa —consultar el evento desde aca— seria una consulta mas en cada
  // pagina del panel para un dato que ya esta cargado.
  const idAbierto = pathname.match(
    /^\/panel\/(?:eventos|asistente)\/([0-9a-f-]{36})/,
  )?.[1];
  const abiertoEvento = idAbierto
    ? eventos.find((e) => e.id === idAbierto)
    : undefined;

  const cerrar = () => setAbierto(false);

  const contenido = (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <Link
        href="/"
        className="mb-4 px-3 pt-2 text-lg font-bold tracking-tight"
        onClick={cerrar}
      >
        Scora<span className="text-lime-400">.</span>
      </Link>

      <Grupo enlaces={CUENTA} pathname={pathname} alElegir={cerrar} />

      {abiertoEvento && (
        <BloqueDeEvento
          evento={abiertoEvento}
          pathname={pathname}
          alElegir={cerrar}
        />
      )}
    </div>
  );

  return (
    <>
      {/* El banner de cuenta. Antes vivia al pie de la barra lateral —avatar,
          nombre, idioma y cerrar sesion— y se repetia entero en cada pantalla
          del panel sin aportar nada mientras se trabaja. Se mueve aca, arriba,
          con el MISMO `MenuDeCuenta` que ya usa la pagina de inicio: una sola
          implementacion del menu de cuenta, no dos que puedan divergir.

          NO lleva `lg:hidden`: en escritorio el div padre de este componente
          tiene `lg:pl-64` (ver `PanelLayout`), asi que este banner, al ser un
          hijo normal del flujo, ya arranca despues del ancho de la barra
          lateral fija — no hace falta una version aparte para pantalla
          grande. Lo unico que se esconde en escritorio es el boton de
          hamburguesa: la barra lateral ya esta a la vista. */}
      <header className="safe-top sticky top-0 z-30 flex items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-3">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Abrir menú"
          className="rounded-lg p-1.5 text-neutral-300 hover:bg-neutral-900 lg:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
        <Link
          href="/panel"
          className="min-w-0 truncate font-bold tracking-tight"
        >
          {abiertoEvento ? abiertoEvento.name : "Scora."}
        </Link>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <SelectorDeIdioma
            actual={idioma}
            elegir={elegirIdioma}
            etiqueta={etiquetaIdioma}
          />
          <MenuDeCuenta
            email={email}
            nombre={nombre || null}
            cerrarSesion={cerrarSesion}
            textos={textosCuenta}
          />
        </div>
      </header>

      {/* Fija en pantalla grande. */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-neutral-800 bg-neutral-950 lg:block">
        {contenido}
      </aside>

      {/* Cajón en pantalla chica. */}
      {abierto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={cerrar}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-neutral-800 bg-neutral-950">
            {contenido}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * La competencia abierta, en su propia caja.
 *
 * LA CAJA IMPORTA. Sin ella, las secciones del evento y las de la cuenta se leen
 * como una sola lista de diez destinos y no se entiende que unas son "de esta
 * competencia" y otras "de mi organizacion". Con el nombre arriba y un marco
 * alrededor, el alcance de cada cosa es obvio sin explicarlo.
 */
function BloqueDeEvento({
  evento,
  pathname,
  alElegir,
}: {
  evento: EventoDelMenu;
  pathname: string;
  alElegir: () => void;
}) {
  const { evento: secciones, administracion } = seccionesDelEvento(evento.id);

  return (
    <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="flex items-start justify-between gap-2 border-b border-neutral-800 px-2 pt-1 pb-2.5">
        <p
          className="min-w-0 flex-1 truncate text-sm font-semibold"
          title={evento.name}
        >
          {evento.name}
        </p>
        <span className="shrink-0 text-xs text-neutral-500">
          {ESTADO[evento.status]}
        </span>
      </div>

      <Encabezado>Evento</Encabezado>
      <Grupo enlaces={secciones} pathname={pathname} alElegir={alElegir} />

      <div className="mt-3 border-t border-neutral-800 pt-2">
        <Encabezado>Administración</Encabezado>
        <Grupo
          enlaces={administracion}
          pathname={pathname}
          alElegir={alElegir}
        />
      </div>
    </div>
  );
}

function Encabezado({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wider text-neutral-500 uppercase">
      {children}
    </p>
  );
}

function Grupo({
  enlaces,
  pathname,
  alElegir,
}: {
  enlaces: Enlace[];
  pathname: string;
  alElegir: () => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {enlaces.map((e) => {
        const activo = e.exacto
          ? pathname === e.href
          : pathname.startsWith(e.href);
        return (
          <Link
            key={e.href}
            href={e.href}
            onClick={alElegir}
            aria-current={activo ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              activo
                ? "bg-neutral-800 text-neutral-50"
                : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
            }`}
          >
            <Icono nombre={e.icono} className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{e.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
