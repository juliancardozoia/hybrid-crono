"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icono } from "@/shared/components/Icono";
import { elegirCompetencia } from "@/features/panel/actions";
import type { EventoDelMenu } from "./MenuLateral";

const ESTADO: Record<EventoDelMenu["status"], string> = {
  draft: "Borrador",
  ready: "Lista",
  live: "En vivo",
  verifying: "Verificando",
  published: "Publicada",
};

/**
 * El selector de competencias, estilo el project-switcher de Vercel: la
 * competencia abierta se ve siempre en la esquina superior, y desde el mismo
 * control se busca, se cambia a otra o se crea una nueva. Reemplaza a la
 * seccion "Organizo" que antes vivia sola y sin buscador en /panel — ahora
 * TODA la navegacion entre competencias pasa por aca.
 *
 * `competencias` viene de `listEventosQueOrganizo()` (ver layout.tsx), no de
 * `listEvents()`: es exactamente "lo que administro", que es lo que tiene
 * sentido poder elegir en un switcher. Un atleta sin ninguna competencia
 * propia ve la lista vacia, pero el boton "Crear competencia" sigue ahi.
 */
export function SelectorDeCompetencias({
  competencias,
  actualId,
}: {
  competencias: EventoDelMenu[];
  actualId?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const caja = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

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
    // Arranca enfocado en el buscador: igual que "Find Project..." en
    // Vercel, el selector se abre para escribir, no solo para mirar.
    inputRef.current?.focus();

    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  const actual = competencias.find((c) => c.id === actualId);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return competencias;
    return competencias.filter((c) => c.name.toLowerCase().includes(q));
  }, [competencias, busqueda]);

  function abrir() {
    setBusqueda("");
    setAbierto(true);
  }

  function elegir(id: string) {
    setAbierto(false);
    // `elegirCompetencia` guarda la cookie y hace `redirect("/panel")` DEL
    // LADO DEL SERVIDOR -- misma jugada que `signInWithOAuth`: una accion de
    // servidor para que el redirect tambien lo sea. `startTransition` evita
    // que React se queje de despachar una navegacion fuera de un evento
    // manejado por ella.
    startTransition(() => {
      elegirCompetencia(id);
    });
  }

  return (
    <div ref={caja} className="relative min-w-0">
      <button
        type="button"
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        aria-expanded={abierto}
        aria-haspopup="listbox"
        className="flex min-w-0 max-w-[10rem] items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors hover:bg-neutral-900 sm:max-w-[18rem]"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {actual ? actual.name : "Competencias"}
        </span>
        <Icono
          nombre="flecha"
          className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${
            abierto ? "-rotate-90" : "rotate-90"
          }`}
        />
      </button>

      {abierto && (
        <div
          role="listbox"
          aria-label="Competencias"
          className="absolute left-0 z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 shadow-xl shadow-black/40 sm:w-80"
        >
          <div className="border-b border-neutral-800 p-2">
            <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
              <Icono nombre="buscar" className="h-4 w-4 shrink-0 text-neutral-500" />
              <input
                ref={inputRef}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar competencia..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-500"
              />
            </div>
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {filtradas.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-neutral-500">
                {competencias.length === 0
                  ? "Todavía no organizás ninguna competencia."
                  : "No se encontró ninguna competencia."}
              </li>
            ) : (
              filtradas.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={c.id === actualId}
                    onClick={() => elegir(c.id)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-neutral-900 ${
                      c.id === actualId ? "text-neutral-50" : "text-neutral-300"
                    }`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-800 text-xs font-bold text-neutral-400">
                      {c.name[0]?.toUpperCase() ?? "?"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {ESTADO[c.status]}
                    </span>
                    {c.id === actualId && (
                      <Icono nombre="tilde" className="h-4 w-4 shrink-0 text-lime-400" />
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>

          <Link
            href="/panel/eventos/nuevo"
            onClick={() => setAbierto(false)}
            className="flex items-center gap-2 border-t border-neutral-800 px-4 py-3 text-sm font-medium text-lime-400 hover:bg-neutral-900"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-lime-400/10 text-base leading-none">
              +
            </span>
            Crear competencia
          </Link>
        </div>
      )}
    </div>
  );
}
