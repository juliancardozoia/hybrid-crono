"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icono } from "@/shared/components/Icono";
import { useCarga } from "@/shared/components/Carga";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { setEventStatus } from "../config/actions";
import { togglePublicacion } from "../actions";
import type { EventStatus } from "@/lib/supabase/types";

/**
 * Las acciones sobre la competencia, agrupadas en un menu de "...", estilo el
 * menu de tres puntos que Vercel pone junto a cada deployment: cambiar de
 * estado (Marcar como lista / Poner en vivo / Volver a borrador) y publicar o
 * quitar del catalogo. Antes eran botones sueltos repartidos en media
 * pantalla del Resumen ("Estado de la competencia" con sus propios botones,
 * "Catalogo publico" con `BotonPublicar` aparte); son las MISMAS dos
 * acciones de siempre (`setEventStatus`, `togglePublicacion`), solo que ahora
 * viven juntas donde tiene sentido buscarlas.
 *
 * Mismo patron que `BotonPublicar` (ahora retirado): `useTransition` +
 * overlay global (`useCarga`) + toast (`useNotificaciones`), en vez de
 * `useActionState`/`FormularioDeEstado` -- no hay campos que validar inline,
 * asi que no hace falta el mecanismo de formulario.
 */
export function MenuDeAccionesDeCompetencia({
  eventId,
  status,
  completo,
  publicado,
  puedePublicar,
}: {
  eventId: string;
  status: EventStatus;
  /** Si es false, "Marcar como lista" se muestra pero deshabilitado. */
  completo: boolean;
  publicado: boolean;
  puedePublicar: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [, startTransition] = useTransition();
  const caja = useRef<HTMLDivElement>(null);
  const { activar, desactivar } = useCarga();
  const { exito, error } = useNotificaciones();

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

  function cambiarEstado(nuevo: EventStatus, mensajeDeCarga: string) {
    setAbierto(false);
    startTransition(async () => {
      activar(mensajeDeCarga);
      try {
        const r = await setEventStatus(eventId, nuevo);
        if (r.error) error(r.error);
      } finally {
        desactivar();
      }
    });
  }

  function alternarPublicacion() {
    setAbierto(false);
    startTransition(async () => {
      activar(publicado ? "Quitando del catálogo…" : "Publicando…");
      try {
        const r = await togglePublicacion(eventId, !publicado);
        if (r.error) {
          error(r.error);
        } else {
          exito(publicado ? "Se quitó del catálogo." : "Se publicó en el catálogo.");
        }
      } finally {
        desactivar();
      }
    });
  }

  return (
    <div ref={caja} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        aria-label="Acciones de la competencia"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100"
      >
        <Icono nombre="puntos" className="h-5 w-5" grosor={3} />
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 py-1 shadow-xl shadow-black/40"
        >
          {status === "draft" && (
            <button
              type="button"
              role="menuitem"
              disabled={!completo}
              title={!completo ? "Completa la configuración pendiente primero." : undefined}
              onClick={() => cambiarEstado("ready", "Marcando la competencia como lista…")}
              className="flex w-full items-center px-4 py-2.5 text-left text-sm text-neutral-200 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-600 disabled:hover:bg-transparent"
            >
              Marcar como lista
            </button>
          )}

          {status === "ready" && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => cambiarEstado("live", "Poniendo la competencia en vivo…")}
                className="flex w-full items-center px-4 py-2.5 text-left text-sm text-neutral-200 hover:bg-neutral-900"
              >
                Poner en vivo
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => cambiarEstado("draft", "Volviendo a borrador…")}
                className="flex w-full items-center px-4 py-2.5 text-left text-sm text-neutral-400 hover:bg-neutral-900"
              >
                Volver a borrador
              </button>
            </>
          )}

          {(status === "draft" || status === "ready") && (
            <div className="my-1 border-t border-neutral-800" />
          )}

          {puedePublicar ? (
            <button
              type="button"
              role="menuitem"
              onClick={alternarPublicacion}
              className="flex w-full items-center px-4 py-2.5 text-left text-sm text-neutral-200 hover:bg-neutral-900"
            >
              {publicado ? "Quitar del catálogo" : "Publicar en el catálogo"}
            </button>
          ) : (
            // Plan gratuito: se ofrece igual, pero lleva a cambiar de plan en
            // vez de intentar algo que Postgres va a rechazar (PL001).
            <Link
              href="/panel/organizacion/plan"
              role="menuitem"
              onClick={() => setAbierto(false)}
              className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-neutral-500 hover:bg-neutral-900"
            >
              Publicar en el catálogo
              <span className="text-xs text-neutral-600">Plan Pro</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
