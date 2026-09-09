"use client";

import { useActionState, useState } from "react";
import { crearRegistroManual, type FormState } from "../actions";
import { Modal, BotonesDeModal } from "@/shared/components/Modal";
import { BotonAbrirModal } from "@/shared/components/BotonAbrirModal";
import { Selector } from "@/shared/components/Selector";
import { CampoBase, Field, Select } from "@/shared/components/SimpleForm";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import { PAISES } from "@/shared/utils/paises";

const subtitulo =
  "text-xs font-medium tracking-wide text-neutral-500 uppercase";

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
 *
 * REQUERIDOS PRIMERO, OPCIONALES DESPUES — en cada bloque de integrante, y
 * tambien en el formulario entero: "Estado de registro" cierra el formulario
 * porque aplica a la inscripcion completa, no a cada persona.
 */
export function AltaDeAtleta({
  eventId,
  divisiones,
  tallas,
}: {
  eventId: string;
  divisiones: DivisionParaAlta[];
  /** `events.shirt_sizes`. Vacio = la competencia no entrega remera. */
  tallas: string[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [divisionId, setDivisionId] = useState("");
  const [state, formAction, pending] = useActionState(
    crearRegistroManual,
    inicial,
  );

  const division = divisiones.find((d) => d.id === divisionId);
  const teamSize = division?.teamSize ?? 1;

  return (
    <>
      <BotonAbrirModal onClick={() => setAbierto(true)}>Crear atleta</BotonAbrirModal>

      <Modal
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Crear atleta"
        ancho="max-w-2xl"
      >
        {/* `key` remonta el formulario cada vez que se abre: sin esto, un
            intento a medias que se cancelo dejaba los campos con lo ultimo
            escrito la proxima vez que se abriera el modal. */}
        <form
          key={abierto ? "abierto" : "cerrado"}
          id="nuevo-registro"
          action={formAction}
          className="flex flex-col gap-4 text-left"
        >
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="teamSize" value={teamSize} />

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoBase label="Categoría">
              <Selector
                name="divisionId"
                required
                value={divisionId}
                onChange={(e) => setDivisionId(e.target.value)}
                className="w-full py-3"
              >
                <option value="" disabled>
                  Elige una categoría…
                </option>
                {divisiones.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Selector>
            </CampoBase>

            {teamSize > 1 && (
              <Field label="Nombre del equipo (opcional)" name="teamName" />
            )}
          </div>

          <div className="flex flex-col gap-4">
            {/* La key es SOLO el indice, no `${divisionId}-${i}`. Con el
                divisionId adentro, cambiar de categoria a medio llenar el
                formulario remontaba TODOS los bloques y borraba lo ya
                escrito — el bug reportado. Cambiar de categoria solo agrega o
                quita bloques del final (`teamSize` distinto); los que ya
                estaban no tienen por que perder lo que tenian. */}
            {Array.from({ length: teamSize }, (_, i) => (
              <BloqueDeIntegrante
                key={i}
                indice={i}
                soloUno={teamSize === 1}
                tallas={tallas}
              />
            ))}
          </div>

          <div className="border-t border-neutral-800 pt-4">
            <Select
              label="Estado de registro"
              name="estado"
              defaultValue="aprobado"
              options={[
                { value: "aprobado", label: "Aprobado" },
                { value: "pendiente", label: "Pendiente" },
              ]}
            />
          </div>

          {state.error && (
            <MensajeDeError>{state.error}</MensajeDeError>
          )}
        </form>

        <BotonesDeModal
          cancelar={() => setAbierto(false)}
          guardando={pending}
          error={state.error}
          guardarId="nuevo-registro"
          etiqueta="Crear atleta"
          mensajeDeCarga="Registrando…"
        />
      </Modal>
    </>
  );
}

function BloqueDeIntegrante({
  indice,
  soloUno,
  tallas,
}: {
  indice: number;
  soloUno: boolean;
  tallas: string[];
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

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4">
          <p className={subtitulo}>Campos requeridos</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" name={`firstName_${indice}`} required />
            <Field label="Apellido" name={`lastName_${indice}`} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" name={`email_${indice}`} type="email" required />
            <Field
              label="Fecha de nacimiento"
              name={`birthDate_${indice}`}
              type="date"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoBase label="País">
              <Selector
                name={`country_${indice}`}
                required
                defaultValue=""
                onChange={(e) => setPais(e.target.value)}
                className="w-full py-3"
              >
                <option value="" disabled>
                  Elige un país…
                </option>
                {PAISES.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nombre}
                  </option>
                ))}
              </Selector>
            </CampoBase>
            <Field label="Documento (DNI)" name={`documentId_${indice}`} required />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <p className={subtitulo}>Campos opcionales</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={etiquetaSubdivision} name={`stateProvince_${indice}`} />
            <Select
              label="Sexo"
              name={`gender_${indice}`}
              defaultValue=""
              options={[
                { value: "", label: "Sin especificar" },
                { value: "male", label: "Masculino" },
                { value: "female", label: "Femenino" },
                { value: "other", label: "Otro" },
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Box" name={`box_${indice}`} />
            <Field
              label="Teléfono"
              name={`phone_${indice}`}
              type="tel"
              placeholder="+57 300 1234567"
            />
          </div>

          {tallas.length > 0 && (
            <Select
              label="Talla de ropa"
              name={`shirtSize_${indice}`}
              defaultValue=""
              options={[
                { value: "", label: "Sin elegir" },
                ...tallas.map((t) => ({ value: t, label: t })),
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
