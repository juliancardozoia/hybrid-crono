import { PantallaDeCuenta } from "@/features/auth/components/PantallaDeCuenta";
import { FormularioSimpleDeCuenta } from "@/features/auth/components/FormularioSimpleDeCuenta";
import { CampoDeClave } from "@/features/auth/components/CampoDeClave";
import { updatePassword } from "@/features/auth/actions";
import { traduccion } from "@/shared/i18n/servidor";

export const metadata = { title: "Nueva contraseña — Scora" };

/**
 * Se llega aca por el enlace del correo, que ya dejo una sesion abierta. Por eso
 * no se pide la contraseña anterior: quien la olvido no la puede escribir, y la
 * barrera real fue el acceso a la casilla.
 */
export default async function NuevaClavePage() {
  const { t } = await traduccion();

  return (
    <PantallaDeCuenta titulo="auth.nueva.titulo" subtitulo="auth.nueva.subtitulo">
      <FormularioSimpleDeCuenta
        action={updatePassword}
        submitLabel={t("auth.nueva.boton")}
        esperando={t("auth.espera")}
      >
        <CampoDeClave
          label={t("auth.claveNueva")}
          ver={t("auth.claveVer")}
          ocultar={t("auth.claveOcultar")}
          autoComplete="new-password"
          minLength={8}
          pista={t("auth.clavePista")}
        />
        <CampoDeClave
          name="password2"
          label={t("auth.claveRepetir")}
          ver={t("auth.claveVer")}
          ocultar={t("auth.claveOcultar")}
          autoComplete="new-password"
          minLength={8}
        />
      </FormularioSimpleDeCuenta>
    </PantallaDeCuenta>
  );
}
