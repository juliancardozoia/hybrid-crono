import { AuthForm } from "@/features/auth/components/AuthForm";
import { PantallaDeCuenta } from "@/features/auth/components/PantallaDeCuenta";
import { signUp } from "@/features/auth/actions";
import { traduccion } from "@/shared/i18n/servidor";

export const metadata = { title: "Crear cuenta — Scora" };

export default async function RegistroPage() {
  const { idioma } = await traduccion();

  return (
    <PantallaDeCuenta titulo="auth.registro.titulo" subtitulo="auth.registro.subtitulo">
      <AuthForm mode="registro" action={signUp} idioma={idioma} />
    </PantallaDeCuenta>
  );
}
