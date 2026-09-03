import Link from "next/link";
import { listEvents } from "@/features/events/queries";
import { Icono } from "@/shared/components/Icono";
import type { EventStatus } from "@/lib/supabase/types";

export const metadata = { title: "Mis competencias — Scora" };

/**
 * El tablero del organizador.
 *
 * YA NO EXISTE LA PANTALLA DE "CREA TU ORGANIZACION". El layout la crea sola al
 * entrar, asi que quien se registra para organizar llega directo aqui: si no
 * tiene competencias ve un boton grande que lleva al asistente, y si tiene, su
 * lista. Un paso menos entre registrarse y hacer lo que vino a hacer.
 */

const ESTADOS: Record<EventStatus, { texto: string; clase: string }> = {
  draft: { texto: "Borrador", clase: "bg-neutral-800 text-neutral-400" },
  ready: { texto: "Lista", clase: "bg-sky-500/15 text-sky-300" },
  live: { texto: "En vivo", clase: "bg-lime-500/15 text-lime-300" },
  verifying: { texto: "Verificando", clase: "bg-amber-500/15 text-amber-300" },
  published: { texto: "Publicada", clase: "bg-emerald-500/15 text-emerald-300" },
};

export default async function PanelPage() {
  const eventos = await listEvents();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 lg:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mis Competencias</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {eventos.length === 0
              ? "Todavía no creaste ninguna."
              : `${eventos.length} en total`}
          </p>
        </div>

        {eventos.length > 0 && (
          <Link
            href="/panel/eventos/nuevo"
            className="rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300"
          >
            Nueva competencia
          </Link>
        )}
      </div>

      {eventos.length === 0 ? (
        <PrimeraVez />
      ) : (
        <ul className="flex flex-col gap-2">
          {eventos.map((e) => {
            const estado = ESTADOS[e.status];
            return (
              <li key={e.id}>
                <Link
                  href={`/panel/eventos/${e.id}`}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-800 p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/40"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{e.name}</p>
                    <p className="truncate text-sm text-neutral-500">
                      {[e.venue, e.event_date].filter(Boolean).join(" · ") ||
                        "Sin fecha ni sede"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${estado.clase}`}
                  >
                    {estado.texto}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/**
 * Lo que ve alguien que acaba de registrarse.
 *
 * Un solo camino y bien grande. Antes esta pantalla pedia crear una
 * organizacion —un concepto que no significa nada el primer dia— y el boton de
 * crear competencia estaba dos pantallas mas adelante.
 */
function PrimeraVez() {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/30 p-10 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-lime-400/10 text-lime-400">
        <Icono nombre="trofeo" className="h-7 w-7" />
      </span>

      <h2 className="mt-5 text-xl font-bold">Crea tu primera competencia</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-400">
        Te vamos a ir pidiendo los datos por pasos: nombre y fecha, categorías, pruebas y
        precios. Se guarda como borrador desde el primer paso, así que puedes cerrar y seguir
        después.
      </p>

      <Link
        href="/panel/eventos/nuevo"
        className="mt-6 inline-block rounded-xl bg-lime-400 px-6 py-3 font-bold text-lime-950 transition-colors hover:bg-lime-300"
      >
        Crear competencia
      </Link>

      <p className="mt-6 border-t border-neutral-800 pt-5 text-sm text-neutral-500">
        ¿Viniste a competir o a juzgar?{" "}
        <Link href="/cuenta" className="text-lime-400 hover:underline">
          Ve a tu perfil de atleta
        </Link>
      </p>
    </div>
  );
}
