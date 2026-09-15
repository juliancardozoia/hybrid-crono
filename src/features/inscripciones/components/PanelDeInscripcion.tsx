"use client";

import { useActionState, useState, useTransition } from "react";
import {
  cancelarInscripcion,
  enviarInscripcion,
  guardarMisDatos,
  invitarIntegrante,
  type FormState,
} from "../actions";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import type { CampoDelFormulario } from "../queries";
import type {
  RegistrationMemberRow,
  RegistrationRow,
} from "@/lib/supabase/types";
import { BloqueDePago } from "@/features/pagos/components/BloqueDePago";
import type { PagoDeInscripcion } from "@/features/pagos/queries";
import { Boton, claseDeBoton } from "@/shared/components/Boton";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { useCarga } from "@/shared/components/Carga";
import { useNotificaciones } from "@/shared/components/Notificaciones";
import { CamposDeAtleta } from "./CamposDeAtleta";

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
          // En individual el capitan ES el unico integrante: guardar sus datos
          // y enviar la inscripcion son el mismo paso para el atleta, y
          // separarlos en dos botones es lo que confundia. En equipo siguen
          // siendo dos pasos distintos porque el capitan no puede enviar hasta
          // que TODOS completen los suyos.
          confirmarAlGuardar={teamSize === 1 && soyCapitan}
        />
      )}

      {!yo && (
        <p className="rounded-2xl border border-neutral-800 p-4 text-sm text-neutral-400">
          Estás viendo esta inscripción pero no eres parte del equipo.
        </p>
      )}

      {teamSize === 1 && soyCapitan && !cerrada && (
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
          className="self-start text-sm text-neutral-600 hover:text-red-400"
        >
          Cancelar inscripción
        </button>
      )}

      {teamSize > 1 && soyCapitan && !cerrada && (
        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-6">
          <Boton
            disabled={!equipoCompleto}
            cargando={pendiente}
            textoCargando="Enviando…"
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
          >
            Enviar inscripción
          </Boton>

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
          className={claseDeBoton({ variante: "primary" })}
        >
          Invitar
        </BotonDeEnvio>
      </div>

      {state.error && (
        <MensajeDeError compacto>{state.error}</MensajeDeError>
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
  confirmarAlGuardar,
}: {
  registrationId: string;
  miembro: RegistrationMemberRow;
  tallas: string[];
  campos: CampoDelFormulario[];
  documentos: Array<{ name: string; url: string; requiresAcceptance: boolean }>;
  confirmarAlGuardar: boolean;
}) {
  // NO usa `<form action={formAction}>`: React 19 llama a form.reset() nativo
  // apenas la accion termina -incluso si termina en error- y eso borraba todo
  // lo tipeado con solo olvidar tildar "acepto los terminos". Se invoca la
  // accion a mano, mismo patron que "Enviar inscripcion"/"Cancelar
  // inscripcion" en el panel padre.
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { activar, desactivar } = useCarga();
  const { exito, error: avisarError } = useNotificaciones();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);

    startTransition(async () => {
      activar(confirmarAlGuardar ? "Confirmando la inscripción…" : "Guardando tus datos…");
      try {
        const r = await guardarMisDatos({ error: null }, formData);
        if (r.error) {
          setError(r.error);
          avisarError(r.error);
          return;
        }

        if (confirmarAlGuardar) {
          const r2 = await enviarInscripcion(registrationId);
          if (r2.error) {
            setError(r2.error);
            avisarError(r2.error);
            return;
          }
          exito("Inscripción confirmada.");
        } else {
          exito("Datos guardados.");
        }
      } finally {
        desactivar();
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 border-t border-neutral-800 pt-6"
    >
      <input type="hidden" name="registrationId" value={registrationId} />
      <input type="hidden" name="memberId" value={miembro.id} />

      <h2 className="text-sm font-semibold text-neutral-400 uppercase">
        Mis datos
      </h2>

      <CamposDeAtleta
        valores={{
          firstName: miembro.first_name,
          lastName: miembro.last_name,
          birthDate: miembro.birth_date,
          gender: miembro.gender,
          phone: miembro.phone,
          shirtSize: miembro.shirt_size,
          answers: miembro.answers as Record<string, string> | null,
          aceptado: miembro.accepted_terms_at !== null,
        }}
        tallas={tallas}
        campos={campos}
        documentos={documentos}
      />

      {error && <MensajeDeError>{error}</MensajeDeError>}

      <div>
        <Boton
          type="submit"
          cargando={pendiente}
          textoCargando={confirmarAlGuardar ? "Confirmando…" : "Guardando…"}
          variante="primary"
        >
          {confirmarAlGuardar ? "Confirmar inscripción" : "Guardar mis datos"}
        </Boton>
      </div>
    </form>
  );
}
