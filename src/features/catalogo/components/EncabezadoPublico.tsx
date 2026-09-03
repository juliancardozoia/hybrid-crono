import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { signOut } from "@/features/auth/actions";
import { MenuDeCuenta } from "./MenuDeCuenta";
import { SelectorDeIdioma } from "@/shared/components/SelectorDeIdioma";
import { elegirIdioma } from "@/shared/i18n/acciones";
import { traduccion } from "@/shared/i18n/servidor";

/**
 * Encabezado del portal publico.
 *
 * UN SOLO BOTON. Es la unica parte del sitio que ve alguien sin cuenta y viene
 * a buscar competencias, no a administrar nada: cuatro links compitiendo con el
 * buscador solo le sacan atencion. Sin sesion, "Mi cuenta" lleva al login; con
 * sesion abre el menu con las tres cosas que hace la misma cuenta.
 */
export async function EncabezadoPublico() {
  const { idioma, t } = await traduccion();

  // La app corre sin Supabase configurado para poder trabajar en el spike; en
  // ese modo simplemente no hay sesion que mostrar.
  const usuario = supabaseConfigured()
    ? (await (await createClient()).auth.getUser()).data.user
    : null;

  const nombre =
    (usuario?.user_metadata?.full_name as string | undefined)?.trim() || null;

  return (
    <header className="safe-top sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="font-bold tracking-tight">
          Scora<span className="text-lime-400">.</span>
        </Link>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <SelectorDeIdioma actual={idioma} elegir={elegirIdioma} etiqueta={t("cuenta.idioma")} />

          {usuario ? (
            <MenuDeCuenta
              email={usuario.email ?? ""}
              nombre={nombre}
              cerrarSesion={signOut}
              textos={{
                mi: t("cuenta.mi"),
                panel: t("cuenta.panel"),
                inscripciones: t("cuenta.inscripciones"),
                juzgar: t("cuenta.juzgar"),
                salir: t("cuenta.salir"),
              }}
            />
          ) : (
            <Link
              href="/login"
              className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300"
            >
              {t("cuenta.mi")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
