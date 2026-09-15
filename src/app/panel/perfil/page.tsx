import { redirect } from "next/navigation";
import { FotoDePerfil } from "@/features/cuenta/components/FotoDePerfil";
import { FormularioDePerfil } from "@/features/cuenta/components/FormularioDePerfil";
import { getPerfil } from "@/features/cuenta/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mi perfil — Scora" };

/**
 * Mi perfil: SOLO foto y datos personales.
 *
 * Vive DENTRO de /panel, como todo lo demas -- antes era `/cuenta`, una
 * pantalla suelta con su propio encabezado publico y pie de pagina, distinta
 * del resto del panel que ya tiene su propia barra lateral. No hay motivo
 * para que el perfil sea la unica pantalla de la cuenta con un chrome
 * distinto: el layout de /panel ya pone la barra, el selector de idioma y el
 * menu de cuenta.
 *
 * "Compito", "Organizo" y "Juzgo" viven en `/panel` (la raiz): esta pantalla
 * es un DESTINO al que se llega desde ahi (el aviso de perfil incompleto, o
 * el link "Mi perfil" de la barra), no el primer lugar que alguien ve
 * despues de inscribirse.
 */
export default async function PerfilPage() {
  const perfil = await getPerfil();
  if (!perfil) redirect("/login?volver=%2Fpanel%2Fperfil");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6 lg:p-10">
      <h1 className="text-2xl font-bold tracking-tight">Mi perfil</h1>

      <section className="flex flex-col gap-6 rounded-2xl border border-neutral-800 p-6">
        <FotoDePerfil
          url={perfil.avatarUrl}
          nombre={perfil.fullName ?? perfil.email}
          userId={perfil.id}
        />
        <FormularioDePerfil perfil={perfil} />
      </section>
    </main>
  );
}
