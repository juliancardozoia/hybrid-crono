"use client";

import { useActionState, useState } from "react";
import { crearRegistroManual, type FormState } from "../actions";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { PAISES } from "@/shared/utils/paises";

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-3 py-2.5 text-sm outline-none transition-colors focus:border-lime-400";
const selector =
  "w-full appearance-none rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm outline-none transition-colors focus:border-lime-400";

// Como se le llama a la subdivision segun el pais. Es cosmetico —el dato se
// guarda igual en `state_province` sea cual sea la etiqueta— pero "Provincia"
// en un formulario mexicano o "Estado" en uno argentino lee raro.
const ETIQUETA_SUBDIVISION: Record<string, string> = {
  AR: "Provincia",
  MX: "Estado",
  US: "Estado",
  BR: "Estado",
  CA: "Provincia",
  CO: "Departamento",
  PE: "Departamento",
  BO: "Departamento",
  UY: "Departamento",
  CR: "Provincia",
  ES: "Provincia",
};

export interface DivisionParaAlta {
  id: string;
  name: string;
  teamSize: number;
}

const inicial: FormState = { error: null };

/**
 * El alta manual, en un modal — no un formulario siempre visible al pie de la
 * pantalla.
 *
 * LA CANTIDAD DE BLOQUES DE INTEGRANTE DEPENDE DE LA DIVISION ELEGIDA. Una
 * categoria de 1 pide un bloque; una de parejas pide dos. Por eso el `<select>`
 * de division vive AFUERA del `<form>` que arma `crearRegistroManual` —bueno,
 * adentro, pero maneja su propio estado— y los bloques se generan con
 * `Array.from({length: teamSize})`.
 *
 * CADA INTEGRANTE COMPLETO DE UNA: nombre, apellido, correo, fecha de
 * nacimiento, pais y documento. No hay un paso de "invitar y esperar" como en
 * la inscripcion publica — el organizador ya tiene los datos de la persona que
 * tiene en frente, y haria esperar sin necesidad.
 */
export function AltaDeAtleta({
  eventId,
  divisiones,
}: {
  eventId: string;
  divisiones: DivisionParaAlta[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [divisionId, setDivisionId] = useState(divisiones[0]?.id ?? "");
  const [state, formAction, pending] = useActionState(
    crearRegistroManual,
    inicial,
  );

  const division = divisiones.find((d) => d.id === divisionId);
  const teamSize = division?.teamSize ?? 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-bold text-lime-950 hover:bg-lime-300"
      >
        + Nuevo registro
      </button>

      <Modal
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Nuevo registro"
        ancho="max-w-2xl"
      >
        {/* `key` remonta el formulario cada vez que se abre: sin esto, un
            intento a medias que se cancelo dejaba los campos con lo ultimo
            escrito la proxima vez que se abriera el modal. */}
        <form
          key={abierto ? "abierto" : "cerrado"}
          id="nuevo-registro"
          action={formAction}
          className="flex flex-col gap-6 text-left"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="teamSize" value={teamSize} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">División</span>
              <select
                name="divisionId"
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
                className={selector}
              >
                {divisiones.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            {teamSize > 1 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  Nombre del equipo (opcional)
                </span>
                <input name="teamName" className={campo} />
              </label>
            )}
          </div>

          <div className="flex flex-col gap-5">
            {Array.from({ length: teamSize }, (_, i) => (
              <BloqueDeIntegrante
                key={`${divisionId}-${i}`}
                indice={i}
                soloUno={teamSize === 1}
              />
            ))}
          </div>

          {state.error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
              {state.error}
            </p>
          )}
        </form>

        <BotonesDeModal
          cancelar={() => setAbierto(false)}
          guardando={pending}
          error={state.error}
          guardarId="nuevo-registro"
          etiqueta="Registrar"
          mensajeDeCarga="Registrando…"
        />
      </Modal>
    </>
  );
}

function BloqueDeIntegrante({
  indice,
  soloUno,
}: {
  indice: number;
  soloUno: boolean;
}) {
  const [pais, setPais] = useState("");
  const etiquetaSubdivision =
    ETIQUETA_SUBDIVISION[pais] ?? "Estado / Provincia";

  return (
    <div className={soloUno ? "" : "rounded-xl border border-neutral-800 p-4"}>
      {!soloUno && (
        <p className="mb-3 text-xs font-medium tracking-wide text-neutral-500 uppercase">
          Integrante {indice + 1}
        </p>
      )}

      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Nombre</span>
            <input name={`firstName_${indice}`} required className={campo} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Apellido</span>
            <input name={`lastName_${indice}`} required className={campo} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Email</span>
            <input
              name={`email_${indice}`}
              type="email"
              required
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Fecha de nacimiento</span>
            <input
              name={`birthDate_${indice}`}
              type="date"
              required
              className={campo}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">País</span>
            <select
              name={`country_${indice}`}
              required
              defaultValue=""
              onChange={(e) => setPais(e.target.value)}
              className={selector}
            >
              <option value="" disabled>
                Elige un país…
              </option>
              {PAISES.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Documento (DNI)</span>
            <input name={`documentId_${indice}`} required className={campo} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              {etiquetaSubdivision} (opcional)
            </span>
            <input name={`stateProvince_${indice}`} className={campo} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Sexo (opcional)</span>
            <select
              name={`gender_${indice}`}
              defaultValue=""
              className={selector}
            >
              <option value="">Sin especificar</option>
              <option value="male">Masculino</option>
              <option value="female">Femenino</option>
              <option value="other">Otro</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
