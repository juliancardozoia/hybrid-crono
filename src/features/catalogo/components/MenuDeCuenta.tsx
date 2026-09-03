"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icono } from "@/shared/components/Icono";

/**
 * El unico boton del encabezado publico.
 *
 * Sin sesion es un link a /login y nada mas. Con sesion abre un menu, porque la
 * misma cuenta sirve para tres cosas muy distintas —competir, juzgar y
 * organizar— y ninguna de las tres merece un boton propio compitiendo con el
 * buscador, que es a lo que viene el 95% de la gente.
 *
 * Detalles que hacen que un menu se sienta terminado y sin los cuales molesta:
 * cierra con Escape, cierra al hacer click afuera, y `aria-expanded` para que un
 * lector de pantalla sepa si esta abierto. Sin el click afuera, el menu queda
 * pegado tapando la pagina y hay que apretar exactamente el boton otra vez.
 */
export function MenuDeCuenta({
  email,
  nombre,
  cerrarSesion,
  textos,
}: {
  email: string;
  nombre: string | null;
  cerrarSesion: () => Promise<void>;
  // Los textos llegan ya traducidos del servidor: un componente de cliente no
  // puede leer la cookie del idioma sin duplicar la negociacion entera.
  textos: {
    mi: string;
    panel: string;
    inscripciones: string;
    juzgar: string;
    salir: string;
  };
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;

    function fuera(e: MouseEvent) {
      if (!caja.current?.contains(e.target as Node)) setAbierto(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierto(false);
    }

    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  const visible = nombre || email;
  const inicial = (visible[0] ?? "?").toUpperCase();

  return (
    <div ref={caja} className="relative">
      {/* El correo reemplaza a "Mi cuenta": es el dato que identifica la
          sesion sin tener que abrir nada, y en la mayoria de las cuentas
          —sin nombre cargado— era lo unico distinto que igual se veia
          adentro del menu. `max-w` + `truncate` porque un correo corporativo
          largo no puede empujar el selector de idioma que esta al lado. */}
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        aria-label={`${textos.mi}: ${email}`}
        className="flex max-w-[10rem] items-center gap-2 rounded-xl border border-neutral-700 py-1.5 pr-2.5 pl-1.5 text-sm font-medium transition-colors hover:border-neutral-600 hover:bg-neutral-900 sm:max-w-[14rem]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-lime-400 text-sm font-bold text-lime-950">
          {inicial}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{email}</span>
        <Icono
          nombre="flecha"
          className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${abierto ? "-rotate-90" : "rotate-90"}`}
        />
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-xl shadow-black/40"
        >
          {/* El correo ya se ve en el boton: repetirlo aca solo suma cuando
              hay ademas un nombre que mostrar. Sin nombre, el menu arranca
              directo en los destinos y no duplica lo que ya esta arriba. */}
          {nombre && (
            <div className="border-b border-neutral-800 px-4 py-3">
              <p className="truncate font-medium">{nombre}</p>
              <p className="truncate text-xs text-neutral-500">{email}</p>
            </div>
          )}

          <nav className="flex flex-col py-1">
            {[
              // El perfil primero: es donde vive la mitad de competidor de la
              // cuenta, y es a lo que viene la mayoria. El panel es el otro
              // perfil, no otra seccion de este.
              { href: "/cuenta", label: textos.inscripciones },
              { href: "/panel", label: textos.panel },
              { href: "/juez", label: textos.juzgar },
            ].map((i) => (
              <Link
                key={i.href}
                href={i.href}
                role="menuitem"
                onClick={() => setAbierto(false)}
                className="px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-900 hover:text-neutral-100"
              >
                {i.label}
              </Link>
            ))}
          </nav>

          <form action={cerrarSesion} className="border-t border-neutral-800">
            <button
              type="submit"
              role="menuitem"
              className="w-full px-4 py-2.5 text-left text-sm text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
            >
              {textos.salir}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
