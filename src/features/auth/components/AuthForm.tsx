"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BotonDeGoogle } from "./BotonDeGoogle";
import { CampoDeClave } from "./CampoDeClave";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import type { AuthState } from "../actions";
import { crearTraductor } from "@/shared/i18n/diccionario";
import type { Idioma } from "@/shared/i18n/idiomas";

const initial: AuthState = { error: null, message: null };

/**
 * Entrar y crear cuenta, en el mismo componente.
 *
 * Son la misma pantalla con dos palabras cambiadas, y separarlas en dos
 * componentes garantiza que dentro de tres meses una tenga el ojo de la
 * contraseña y la otra no.
 *
 * ORDEN DE LOS ELEMENTOS, QUE NO ES CASUAL
 *
 *   1. Google       el camino corto, y el que no deja cuentas sin confirmar.
 *   2. separador    "o con tu email", no una linea muda: dice que hay abajo.
 *   3. email/clave  el camino de siempre.
 *   4. cambiar      quien cayo en la pantalla equivocada tiene que verlo sin
 *                   buscar. Es el motivo mas comun de abandono en un login.
 *
 * El link de "olvidé mi contraseña" va PEGADO al campo de clave y no perdido en
 * el pie: es el momento exacto en que la persona se da cuenta de que no la
 * recuerda.
 */
export function AuthForm({
  mode,
  action,
  volver,
  idioma,
}: {
  mode: "login" | "registro";
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  volver?: string;
  idioma: Idioma;
}) {
  const t = crearTraductor(idioma);
  const [state, formAction] = useActionState(action, initial);
  const esLogin = mode === "login";

  return (
    <div className="flex flex-col gap-6">
      <BotonDeGoogle
        volver={volver}
        textos={{
          entrar: t("auth.google"),
          abriendo: t("auth.googleAbriendo"),
          error: t("auth.googleError"),
        }}
      />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-neutral-800" />
        <span className="text-xs text-neutral-600">{t("auth.separador")}</span>
        <span className="h-px flex-1 bg-neutral-800" />
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        {volver && <input type="hidden" name="volver" value={volver} />}

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

        <div className="flex flex-col gap-1.5">
          <CampoDeClave
            label={t("auth.clave")}
            ver={t("auth.claveVer")}
            ocultar={t("auth.claveOcultar")}
            autoComplete={esLogin ? "current-password" : "new-password"}
            minLength={esLogin ? undefined : 8}
            pista={esLogin ? undefined : t("auth.clavePista")}
          />
          {esLogin && (
            <Link
              href="/recuperar"
              className="self-end text-xs text-neutral-500 hover:text-lime-400"
            >
              {t("auth.olvide")}
            </Link>
          )}
        </div>

        {state.error && (
          <p
            role="alert"
            className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
          >
            {state.error}
          </p>
        )}
        {state.message && (
          <p
            role="status"
            className="rounded-xl border border-lime-500/40 bg-lime-500/10 p-3 text-sm text-lime-300"
          >
            {state.message}
          </p>
        )}

        <BotonDeEnvio
          pendienteTexto={t("auth.espera")}
          mensajeDeCarga={t("auth.espera")}
          className="w-full rounded-xl bg-lime-400 py-3.5 font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
        >
          {esLogin ? t("auth.botonEntrar") : t("auth.botonRegistro")}
        </BotonDeEnvio>
      </form>

      {!esLogin && (
        <p className="text-xs leading-relaxed text-neutral-600">
          {t("auth.terminos")}
        </p>
      )}

      <p className="border-t border-neutral-800 pt-6 text-sm text-neutral-500">
        {esLogin ? (
          <>
            {t("auth.sinCuenta")}{" "}
            <Link
              href="/registro"
              className="font-medium text-lime-400 hover:underline"
            >
              {t("auth.sinCuentaLink")}
            </Link>
          </>
        ) : (
          <>
            {t("auth.conCuenta")}{" "}
            <Link
              href="/login"
              className="font-medium text-lime-400 hover:underline"
            >
              {t("auth.conCuentaLink")}
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
