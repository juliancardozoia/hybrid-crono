import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/features/auth/actions";
import { asegurarOrganizacion } from "@/features/org/asegurar";
import { getPerfil } from "@/features/cuenta/queries";
import { listEvents } from "@/features/events/queries";
import { MenuLateral } from "@/features/panel/components/MenuLateral";
import { supabaseConfigured } from "@/lib/supabase/env";
import { traduccion } from "@/shared/i18n/servidor";
import { elegirIdioma } from "@/shared/i18n/acciones";

/**
 * El panel del organizador.
 *
 * AQUI SE CREA LA ORGANIZACION, SIN PREGUNTAR. Antes este layout dejaba pasar y
 * la pagina mostraba un "crea tu organizacion" que bloqueaba todo. Ahora
 * `asegurarOrganizacion()` la crea la primera vez y el usuario entra directo a
 * su tablero: es un concepto interno del que no tiene por que enterarse hasta
 * que quiera invitar a alguien.
 */
export default async function PanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // El proyecto puede correr sin Supabase (el spike de la fase 1 no lo necesita).
  // Si alguien entra al panel sin configurarlo, es mejor explicar que falta que
  // tirar un stack trace de "supabaseUrl is required".
  if (!supabaseConfigured()) return <SetupPendiente />;

  const [perfil, { idioma, t }] = await Promise.all([
    getPerfil(),
    traduccion(),
  ]);
  if (!perfil) redirect("/login");

  await asegurarOrganizacion();

  // La lista sirve para que la barra sepa el nombre y el estado de la
  // competencia abierta sin una consulta extra: el id lo saca de la URL.
  const eventos = await listEvents();

  return (
    <div className="min-h-dvh lg:pl-64">
      <MenuLateral
        nombre={perfil.fullName ?? ""}
        email={perfil.email}
        cerrarSesion={signOut}
        idioma={idioma}
        elegirIdioma={elegirIdioma}
        etiquetaIdioma={t("cuenta.idioma")}
        textosCuenta={{
          mi: t("cuenta.mi"),
          panel: t("cuenta.panel"),
          inscripciones: t("cuenta.inscripciones"),
          juzgar: t("cuenta.juzgar"),
          salir: t("cuenta.salir"),
        }}
        eventos={eventos.map((e) => ({
          id: e.id,
          name: e.name,
          status: e.status,
        }))}
      />
      <div className="flex min-h-dvh flex-col">{children}</div>
    </div>
  );
}

function SetupPendiente() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Falta conectar Supabase</h1>
        <p className="mt-2 text-neutral-400">
          El panel necesita base de datos. El cronómetro de la fase 1 funciona
          sin esto: está en{" "}
          <Link href="/spike" className="text-lime-400 hover:underline">
            /spike
          </Link>
          .
        </p>
      </div>

      <ol className="flex flex-col gap-3 text-sm text-neutral-300">
        <li>
          <strong className="text-neutral-100">1.</strong> Crea un proyecto en
          supabase.com
        </li>
        <li>
          <strong className="text-neutral-100">2.</strong> Copia{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5">
            .env.local.example
          </code>{" "}
          a{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5">
            .env.local
          </code>{" "}
          y completa las claves
        </li>
        <li>
          <strong className="text-neutral-100">3.</strong> Aplica el esquema:{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5">
            supabase link --project-ref &lt;ref&gt; && supabase db push
          </code>
        </li>
        <li>
          <strong className="text-neutral-100">4.</strong> Reinicia el servidor
          de desarrollo
        </li>
      </ol>
    </main>
  );
}
