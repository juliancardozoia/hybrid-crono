import { AuthForm } from "@/features/auth/components/AuthForm";
import { PantallaDeCuenta } from "@/features/auth/components/PantallaDeCuenta";
import { signIn } from "@/features/auth/actions";
import { traduccion } from "@/shared/i18n/servidor";

export const metadata = { title: "Entrar — Scora" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const { volver } = await searchParams;
  const { idioma } = await traduccion();

  return (
    <PantallaDeCuenta titulo="auth.entrar.titulo" subtitulo="auth.entrar.subtitulo">
      <AuthForm mode="login" action={signIn} volver={volver} idioma={idioma} />
    </PantallaDeCuenta>
  );
}
