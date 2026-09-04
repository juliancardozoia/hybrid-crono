"use client";

import { useActionState, useTransition } from "react";
import {
  cancelarInscripcion,
  enviarInscripcion,
  guardarMisDatos,
  invitarIntegrante,
  type FormState,
} from "../actions";
import type { CampoDelFormulario } from "../queries";
import type {
  RegistrationMemberRow,
  RegistrationRow,
} from "@/lib/supabase/types";
import { BloqueDePago } from "@/features/pagos/components/BloqueDePago";
import type { PagoDeInscripcion } from "@/features/pagos/queries";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { useCarga } from "@/shared/components/Carga";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { Selector } from "@/shared/components/Selector";

/**
 * El panel del trámite: quién falta, qué falta y el botón de enviar.
 *
 * El estado de una inscripción es la pregunta que la gente hace cinco veces
 * antes de una competencia ("¿ya quedamos anotados?"), así que la pantalla lo
 * contesta arriba de todo y en una sola línea.
 */

const ESTADO: Record<
  RegistrationRow["status"],
  { texto: string; clase: string }
> = {
  borrador: { texto: "Sin enviar", clase: "bg-neutral-800 text-neutral-300" },
  esperando_integrantes: {
    texto: "Faltan integrantes",
    clase: "bg-amber-400/15 text-amber-300",
  },
  esperando_pago: {
    texto: "Falta pagar",
    clase: "bg-amber-400/15 text-amber-300",
  },
  confirmada: { texto: "Confirmada", clase: "bg-lime-400/15 text-lime-300" },
  cancelada: { texto: "Cancelada", clase: "bg-red-500/15 text-red-300" },
  lista_espera: {
    texto: "En lista de espera",
    clase: "bg-neutral-800 text-neutral-300",
  },
};

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400";
const selector = "w-full py-3";

export function PanelDeInscripcion({
  registro,
  integrantes,
  teamSize,
  tallas,
  campos,
  documentos,
  miId,
  soyCapitan,
  pago,
}: {
  registro: RegistrationRow;
  integrantes: RegistrationMemberRow[];
  teamSize: number;
  tallas: string[];
  campos: CampoDelFormulario[];
  documentos: Array<{ name: string; url: string; requiresAcceptance: boolean }>;
  miId: string | null;
  soyCapitan: boolean;
  pago: PagoDeInscripcion;
}) {
  const [pendiente, startTransition] = useTransition();
  const { activar, desactivar } = useCarga();
  const { exito, error: avisarError } = useNotificaciones();

  const yo = integrantes.find((m) => m.id === miId) ?? null;
  const faltan = integrantes.filter((m) => m.status !== "completo").length;
  const equipoCompleto = integrantes.length === teamSize && faltan === 0;
  const cerrada =
    registro.status === "confirmada" || registro.status === "cancelada";

  const estado = ESTADO[registro.status];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${estado.clase}`}
        >
          {estado.texto}
        </span>
      </div>

      {(registro.status === "esperando_pago" || pago.orden !== null) && (
        <BloqueDePago
          registrationId={registro.id}
          orden={pago.orden}
          medios={pago.medios}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase">
          {teamSize === 1
            ? "Tus datos"
            : `Integrantes (${integrantes.length} de ${teamSize})`}
        </h2>

        <ul className="divide-y divide-neutral-800 rounded-2xl border border-neutral-800">
          {Array.from({ length: teamSize }, (_, i) => i + 1).map((posicion) => {
            const miembro = integrantes.find((m) => m.position === posicion);

            return (
              <li key={posicion} className="flex items-center gap-3 px-4 py-3">
                <span className="font-mono text-sm text-neutral-600">
                  {posicion}
                </span>

                {miembro ? (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {[miembro.first_name, miembro.last_name]
                          .filter(Boolean)
                          .join(" ") || miembro.invited_email}
                      </span>
                      {(miembro.first_name || miembro.last_name) && (
                        <span className="block truncate text-xs text-neutral-500">
                          {miembro.invited_email}
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-xs ${
                        miembro.status === "completo"
                          ? "text-lime-400"
                          : "text-amber-400"
                      }`}
                    >
                      {miembro.status === "completo"
                        ? "✓ listo"
                        : "faltan datos"}
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-sm text-neutral-600">
                    Lugar libre
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {soyCapitan && !cerrada && integrantes.length < teamSize && (
          <InvitarIntegrante
            registrationId={registro.id}
            position={
              Array.from({ length: teamSize }, (_, i) => i + 1).find(
                (p) => !integrantes.some((m) => m.position === p),
              ) ?? integrantes.length + 1
            }
          />
        )}
      </section>

      {yo && !cerrada && (
        <MisDatos
          registrationId={registro.id}
          miembro={yo}
          tallas={tallas}
          campos={campos}
          documentos={documentos}
        />
      )}

      {!yo && (
        <p className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-400">
          Estás viendo esta inscripción pero no eres parte del equipo.
        </p>
      )}

      {soyCapitan && !cerrada && (
        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-6">
          <button
            type="button"
            disabled={pendiente || !equipoCompleto}
            onClick={() =>
              startTransition(async () => {
                activar("Enviando la inscripción…");
                try {
                  const r = await enviarInscripcion(registro.id);
                  if (r.error) avisarError(r.error);
                  else exito("Inscripción enviada.");
                } finally {
                  desactivar();
                }
              })
            }
            className="rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 hover:bg-lime-300 disabled:opacity-60"
          >
            {pendiente ? "Enviando…" : "Enviar inscripción"}
          </button>

          {!equipoCompleto && (
            <span className="text-sm text-neutral-500">
              {integrantes.length < teamSize
                ? "Falta invitar integrantes."
                : `Falta que ${faltan === 1 ? "alguien complete sus datos" : `${faltan} completen sus datos`}.`}
            </span>
          )}

          <button
            type="button"
            disabled={pendiente}
            onClick={() =>
              startTransition(async () => {
                activar("Cancelando la inscripción…");
                try {
                  const r = await cancelarInscripcion(registro.id);
                  if (r.error) avisarError(r.error);
                  else exito("Inscripción cancelada.");
                } finally {
                  desactivar();
                }
              })
            }
            className="ml-auto text-sm text-neutral-600 hover:text-red-400"
          >
            Cancelar inscripción
          </button>
        </div>
      )}
    </div>
  );
}

function InvitarIntegrante({
  registrationId,
  position,
}: {
  registrationId: string;
  position: number;
}) {
  const [state, formAction] = useActionState(invitarIntegrante, {
    error: null,
  } as FormState);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-2xl border border-neutral-800 p-4"
    >
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="position" value={position} />

      <label className="text-sm font-medium">
        Invitar al integrante {position}
      </label>
      <p className="text-xs text-neutral-500">
        Pon su correo real: es con ese correo que va a entrar a completar sus
        datos.
      </p>

      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <input
          name="email"
          type="email"
          required
          placeholder="companero@correo.com"
          className={campo}
        />
        <BotonDeEnvio
          pendienteTexto="Guardando…"
          mensajeDeCarga="Invitando al integrante…"
          className="rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 hover:bg-lime-300 disabled:opacity-60"
        >
          Invitar
        </BotonDeEnvio>
      </div>

      {state.error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}

function MisDatos({
  registrationId,
  miembro,
  tallas,
  campos,
  documentos,
}: {
  registrationId: string;
  miembro: RegistrationMemberRow;
  tallas: string[];
  campos: CampoDelFormulario[];
  documentos: Array<{ name: string; url: string; requiresAcceptance: boolean }>;
}) {
  const [state, formAction] = useActionState(guardarMisDatos, {
    error: null,
  } as FormState);
  const respuestas = (miembro.answers ?? {}) as Record<string, string>;

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 border-t border-neutral-800 pt-6"
    >
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="memberId" value={miembro.id} />

      <h2 className="text-sm font-semibold text-neutral-400 uppercase">
        Mis datos
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Nombre</span>
          <input
            name="firstName"
            required
            defaultValue={miembro.first_name ?? ""}
            className={campo}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Apellido</span>
          <input
            name="lastName"
            required
            defaultValue={miembro.last_name ?? ""}
            className={campo}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Fecha de nacimiento</span>
          <input
            name="birthDate"
            type="date"
            defaultValue={miembro.birth_date ?? ""}
            className={campo}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Sexo</span>
          <Selector
            name="gender"
            defaultValue={miembro.gender ?? ""}
            className={selector}
          >
            <option value="">Sin especificar</option>
            <option value="male">Masculino</option>
            <option value="female">Femenino</option>
            <option value="other">Otro</option>
          </Selector>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Teléfono</span>
          <input
            name="phone"
            defaultValue={miembro.phone ?? ""}
            className={campo}
          />
        </label>

        {/* Sin tallas configuradas el evento no entrega remera: no se pregunta. */}
        {tallas.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Talla de remera</span>
            <Selector
              name="shirtSize"
              defaultValue={miembro.shirt_size ?? ""}
              className={selector}
            >
              <option value="">Elegir…</option>
              {tallas.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Selector>
          </label>
        )}
      </div>

      {campos.map((c) => (
        <label key={c.key} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{c.label}</span>
          {c.type === "seleccion" ? (
            <Selector
              name={`campo-${c.key}`}
              required={c.required}
              defaultValue={respuestas[c.key] ?? ""}
              className={selector}
            >
              <option value="">Elegir…</option>
              {c.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Selector>
          ) : (
            <input
              name={`campo-${c.key}`}
              required={c.required}
              type={
                c.type === "numero"
                  ? "number"
                  : c.type === "fecha"
                    ? "date"
                    : "text"
              }
              defaultValue={respuestas[c.key] ?? ""}
              className={campo}
            />
          )}
        </label>
      ))}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="acceptTerms"
          defaultChecked={miembro.accepted_terms_at !== null}
          className="mt-1 accent-lime-400"
        />
        <span className="text-sm">
          Acepto los términos de la competencia
          {documentos.length > 0 && (
            <span className="mt-0.5 block text-xs text-neutral-500">
              {documentos.map((d, i) => (
                <span key={d.url}>
                  {i > 0 && " · "}
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline hover:text-neutral-300"
                  >
                    {d.name}
                  </a>
                </span>
              ))}
            </span>
          )}
        </span>
      </label>

      {state.error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          {state.error}
        </p>
      )}

      <div>
        <BotonDeEnvio
          pendienteTexto="Guardando…"
          mensajeDeCarga="Guardando tus datos…"
          className="rounded-xl bg-lime-400 px-5 py-3 font-bold text-lime-950 hover:bg-lime-300 disabled:opacity-60"
        >
          Guardar mis datos
        </BotonDeEnvio>
      </div>
    </form>
  );
}
