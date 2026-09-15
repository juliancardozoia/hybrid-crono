import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/features/auth/actions";
import { getPerfil } from "@/features/cuenta/queries";
import { listEvents } from "@/features/events/queries";
import { puedeJuzgar } from "@/features/judge/queries";
import { MenuLateral } from "@/features/panel/components/MenuLateral";
import { supabaseConfigured } from "@/lib/supabase/env";
import { traduccion } from "@/shared/i18n/servidor";
import { elegirIdioma } from "@/shared/i18n/acciones";

/**
 * El panel: el punto de encuentro de toda cuenta, sea atleta, organizador o
 * juez -- ver "Un solo punto de entrada" en `panel/page.tsx`.
 *
 * NO CREA LA ORGANIZACION SOLO POR ENTRAR. La creaba `asegurarOrganizacion()`
 * en este mismo layout, y tenia sentido cuando /panel era EXCLUSIVO del
 * organizador: quien llegaba aca ya venia a organizar. Ahora que /panel es la
 * puerta de entrada de TODOS -- un atleta que se acaba de inscribir tambien
 * aterriza aca -- crearla en cada visita le dejaria una organizacion fantasma
 * a cada atleta que nunca va a organizar nada. Se sigue creando, pero recien
 * cuando alguien elige de verdad crear una competencia
 * (`panel/eventos/nuevo/page.tsx`), que es el unico momento en que el
 * concepto "organizacion" empieza a importarle a esa cuenta.
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

  // La lista sirve para que la barra sepa el nombre y el estado de la
  // competencia abierta sin una consulta extra: el id lo saca de la URL.
  const [eventos, mostrarJuzgar] = await Promise.all([
    listEvents(),
    puedeJuzgar(),
  ]);

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
        puedeJuzgar={mostrarJuzgar}
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
