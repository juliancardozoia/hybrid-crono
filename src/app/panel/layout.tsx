import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/features/auth/actions";
import { getMyOrganizations } from "@/features/org/queries";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // El proyecto puede correr sin Supabase (el spike de la fase 1 no lo necesita).
  // Si alguien entra al panel sin configurarlo, es mejor explicar que falta que
  // tirar un stack trace de "supabaseUrl is required".
  if (!supabaseConfigured()) {
    return <SetupPendiente />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const orgs = await getMyOrganizations();
  const activa = orgs[0];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-neutral-800 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link href="/panel" className="font-bold">
            Hybrid Crono
          </Link>
          {activa && (
            <span className="text-sm text-neutral-500">
              {activa.name}
              <span className="ml-2 rounded-md bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                {rotulo(activa.role)}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm">
          <Link href="/juez" className="text-neutral-400 hover:text-neutral-100">
            Juzgar
          </Link>
          <span className="hidden text-neutral-500 sm:inline">{user.email}</span>
          <form action={signOut}>
            <button type="submit" className="text-neutral-400 hover:text-neutral-100">
              Salir
            </button>
          </form>
        </div>
      </header>

      <div className="flex-1">{children}</div>
    </div>
  );
}

function rotulo(role: string): string {
  return (
    {
      owner: "dueño",
      admin: "admin",
      head_judge: "juez principal",
      judge: "juez",
    }[role] ?? role
  );
}

function SetupPendiente() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Falta conectar Supabase</h1>
        <p className="mt-2 text-neutral-400">
          El panel necesita base de datos. El cronómetro de la fase 1 funciona sin esto:
          está en <Link href="/spike" className="text-lime-400 hover:underline">/spike</Link>.
        </p>
      </div>

      <ol className="flex flex-col gap-3 text-sm text-neutral-300">
        <li>
          <strong className="text-neutral-100">1.</strong> Crea un proyecto en supabase.com
        </li>
        <li>
          <strong className="text-neutral-100">2.</strong> Copia{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5">.env.local.example</code> a{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5">.env.local</code> y completa las
          claves
        </li>
        <li>
          <strong className="text-neutral-100">3.</strong> Aplica el esquema:{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5">
            supabase link --project-ref &lt;ref&gt; && supabase db push
          </code>
        </li>
        <li>
          <strong className="text-neutral-100">4.</strong> Reinicia el servidor de desarrollo
        </li>
      </ol>
    </main>
  );
}
