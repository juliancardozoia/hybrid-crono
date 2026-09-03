import Link from "next/link";
import { PantallaDeCuenta } from "@/features/auth/components/PantallaDeCuenta";
import { FormularioSimpleDeCuenta } from "@/features/auth/components/FormularioSimpleDeCuenta";
import { requestPasswordReset } from "@/features/auth/actions";
import { traduccion } from "@/shared/i18n/servidor";

export const metadata = { title: "Recuperar contraseña — Scora" };

export default async function RecuperarPage() {
  const { t } = await traduccion();

  return (
    <PantallaDeCuenta
      titulo="auth.recuperar.titulo"
      subtitulo="auth.recuperar.subtitulo"
      pie={
        <Link href="/login" className="text-lime-400 hover:underline">
          {t("auth.recuperar.volver")}
        </Link>
      }
    >
      <FormularioSimpleDeCuenta
        action={requestPasswordReset}
        submitLabel={t("auth.recuperar.boton")}
        esperando={t("auth.espera")}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("auth.email")}</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            placeholder={t("auth.emailEjemplo")}
            className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none transition-colors focus:border-lime-400"
          />
        </label>
      </FormularioSimpleDeCuenta>
    </PantallaDeCuenta>
  );
}
