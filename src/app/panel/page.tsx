import Link from "next/link";
import { listEvents } from "@/features/events/queries";
import { getMyOrganizations } from "@/features/org/queries";
import { createClient } from "@/lib/supabase/server";
import type { EventStatus } from "@/lib/supabase/types";

export const metadata = { title: "Panel — Hybrid Crono" };

const ESTADOS: Record<EventStatus, { texto: string; clase: string }> = {
  draft: { texto: "Borrador", clase: "bg-neutral-800 text-neutral-400" },
  ready: { texto: "Listo", clase: "bg-sky-500/15 text-sky-300" },
  live: { texto: "En vivo", clase: "bg-lime-500/15 text-lime-300" },
  verifying: { texto: "Verificando", clase: "bg-amber-500/15 text-amber-300" },
  published: { texto: "Publicado", clase: "bg-emerald-500/15 text-emerald-300" },
};

export default async function PanelPage() {
  const orgs = await getMyOrganizations();

  if (orgs.length === 0) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return <SinOrganizacion email={user?.email ?? "tu email"} />;
  }

  const eventos = await listEvents();
  const puedeCrear = orgs.some((o) => o.role === "owner" || o.role === "admin");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Competencias</h1>
        {puedeCrear && (
          <span className="flex flex-wrap gap-2">
            <Link
              href="/panel/organizacion/miembros"
              className="rounded-xl border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-900"
            >
              Jueces
            </Link>
          <Link
            href="/panel/eventos/nuevo"
            className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950 hover:bg-lime-300"
          >
            Nueva competencia
          </Link>
          </span>
        )}
      </div>

      {eventos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-neutral-700 p-8 text-center text-neutral-500">
          Todavía no hay competencias.
          {puedeCrear ? " Crea la primera para empezar." : " Pídele a un admin que cree una."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {eventos.map((e) => {
            const estado = ESTADOS[e.status];
            return (
              <li key={e.id}>
                <Link
                  href={`/panel/eventos/${e.id}`}
                  className="flex items-center justify-between rounded-2xl border border-neutral-800 p-4 transition-colors hover:border-neutral-700"
                >
                  <div>
                    <p className="font-semibold">{e.name}</p>
                    <p className="text-sm text-neutral-500">
                      {[e.venue, e.event_date].filter(Boolean).join(" · ") || "Sin fecha ni sede"}
                    </p>
                  </div>
                  <span className={`rounded-lg px-2 py-1 text-xs font-medium ${estado.clase}`}>
                    {estado.texto}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-neutral-600">
        Ingresa a una competencia para configurar el circuito, las divisiones, los atletas y los heats.
      </p>
    </main>
  );
}

/**
 * Pantalla de quien todavia no pertenece a ninguna organizacion.
 *
 * Antes ofrecia directamente "crea tu organizacion", y eso esta mal para el caso
 * mas comun: un juez voluntario que se registra el dia del evento. Ese juez no
 * tiene que crear nada — tiene que esperar a que el organizador lo sume. Si se
 * crea su propia organizacion queda aislado, sin ver ningun carril, y sin
 * entender por que.
 *
 * Por eso el camino del juez va primero, con SU email a la vista para que se lo
 * pase al organizador tal cual.
 */
function SinOrganizacion({ email }: { email: string }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 p-6 pt-12">
      <div>
        <h1 className="text-2xl font-bold">Todavía no estás en ninguna organización</h1>
        <p className="mt-2 text-neutral-400">
          Las competencias, los atletas y los carriles viven adentro de una organización.
        </p>
      </div>

      <section className="rounded-2xl border border-lime-500/40 bg-lime-500/5 p-5">
        <h2 className="font-semibold text-lime-300">Si vienes a juzgar</h2>
        <p className="mt-2 text-sm text-neutral-300">
          Pídele a la organización del evento que te sume. Envíale este email tal cual:
        </p>
        <p className="mt-3 rounded-xl bg-neutral-900 px-4 py-3 font-mono text-sm break-all">
          {email}
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          Apenas te sumen, tus carriles aparecen en{" "}
          <Link href="/juez" className="text-lime-400 hover:underline">
            Juzgar
          </Link>
          . No hace falta que crees nada.
        </p>
      </section>

      <section className="rounded-2xl border border-neutral-800 p-5">
        <h2 className="font-semibold">Si organizas la competencia</h2>
        <p className="mt-2 text-sm text-neutral-400">
          Crea tu organización: es el espacio de tu box o productora, separado del de cualquier
          otro organizador. Desde ahí cargas competencias y sumas a tus jueces.
        </p>
        <Link
          href="/panel/organizacion/nueva"
          className="mt-4 inline-block rounded-xl bg-neutral-100 px-5 py-2.5 text-sm font-bold text-neutral-950 hover:bg-white"
        >
          Crear organización
        </Link>
      </section>
    </main>
  );
}
