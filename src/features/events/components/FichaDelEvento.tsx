"use client";

import { useActionState, useState } from "react";
import { ImagenDelEvento } from "./ImagenDelEvento";
import { claseDeBoton } from "@/shared/components/Boton";
import { BotonDeEnvio } from "@/shared/components/BotonDeEnvio";
import { Selector } from "@/shared/components/Selector";
import { PAISES, husoSugerido } from "@/shared/utils/paises";
import { paraInputLocal } from "@/shared/utils/fecha";
import type { EventRow } from "@/lib/supabase/types";
import type { FormState } from "../actions";
import { TALLAS } from "../lib/tallas";
import { MensajeDeError } from "@/shared/components/MensajeDeError";

/**
 * La ficha de la competencia.
 *
 * La misma la usan el alta —primer paso del asistente— y la edicion posterior,
 * porque son los mismos campos y duplicarlos garantizaria que en algun momento
 * uno tenga un campo que el otro no.
 *
 * Es de cliente por dos cosas que se ayudan solas: elegir el pais sugiere el
 * huso, y las fechas se muestran en hora de pared del evento. Un organizador
 * colombiano no deberia tener que saber que existe UTC.
 */

const campo =
  "rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400";
const selector = "w-full py-3";

function Etiqueta({
  children,
  texto,
  ayuda,
}: {
  children: React.ReactNode;
  texto: string;
  ayuda?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{texto}</span>
      {children}
      {ayuda && <span className="text-xs text-neutral-500">{ayuda}</span>}
    </label>
  );
}

/**
 * Una seccion del formulario.
 *
 * EL TITULO SE LEE COMO UN TITULO Y VA SOLO. Antes era un renglon gris en
 * versalitas del mismo tamaño que las etiquetas de los campos, y el formulario
 * se leia como una lista plana de veinte controles.
 *
 * Y no lleva subtitulo: "Donde — donde se corre" no agrega nada que el titulo no
 * diga ya, y una linea de texto explicando cada una de las cinco secciones es
 * una pantalla mas larga por la que hay que pasar en cada visita. La ayuda se
 * reserva para los campos donde de verdad hace falta.
 */
/**
 * El navegador (Chrome) autocompleta la hora de un `datetime-local` vacio con
 * la hora ACTUAL apenas el organizador elige una fecha en el calendario, sin
 * que nadie haya tocado el reloj. Si el campo todavia no tenia valor, se
 * descarta esa hora y se fuerza 00:00 — el organizador la cambia si quiere.
 * Una vez que el campo ya tiene un valor, los cambios de hora se respetan tal
 * cual: esto solo corrige el autocompletado del primer click.
 */
function siempreConHoraCero(valorPrevio: string, valorNuevo: string): string {
  if (valorPrevio || !valorNuevo) return valorNuevo;
  return `${valorNuevo.slice(0, 10)}T00:00`;
}

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  // `first-of-type`, no `first`: el form arranca con `<input type="hidden">`
  // antes de la primera Seccion, asi que `:first-child` nunca la alcanza y el
  // borde de arriba se pintaba igual, duplicando la linea que ya pone el
  // asistente debajo del titulo del paso.
  return (
    <section className="flex flex-col gap-5 border-t border-neutral-800 pt-7 first-of-type:border-0 first-of-type:pt-0">
      <h3 className="flex items-center gap-3 text-base font-semibold text-neutral-100">
        <span
          aria-hidden
          className="h-4 w-1 shrink-0 rounded-full bg-lime-400/70"
        />
        {titulo}
      </h3>
      {children}
    </section>
  );
}

export function FichaDelEvento({
  action,
  hidden,
  evento,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  /** null cuando se está creando. */
  evento: EventRow | null;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {
    error: null,
  } as FormState);
  const [pais, setPais] = useState(evento?.country ?? "");
  const [huso, setHuso] = useState(evento?.timezone ?? "America/Bogota");
  const [startsAt, setStartsAt] = useState(
    paraInputLocal(evento?.starts_at ?? null, huso),
  );
  const [endsAt, setEndsAt] = useState(
    paraInputLocal(evento?.ends_at ?? null, huso),
  );
  const [registrationOpensAt, setRegistrationOpensAt] = useState(
    paraInputLocal(evento?.registration_opens_at ?? null, huso),
  );
  const [registrationClosesAt, setRegistrationClosesAt] = useState(
    paraInputLocal(evento?.registration_closes_at ?? null, huso),
  );

  const prefijo = PAISES.find((p) => p.codigo === pais)?.prefijo ?? "";

  return (
    <form id="ficha-evento" action={formAction} className="flex flex-col gap-6">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="timezone" value={huso} />

      <Seccion titulo="Identidad">
        {/* Nombre, formato y modalidad en una fila desde `md`: el nombre pide
            mas ancho que los dos selectores. Por debajo se apilan. */}
        <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr]">
          <Etiqueta texto="Nombre de la competencia">
            <input
              name="name"
              required
              minLength={3}
              defaultValue={evento?.name ?? ""}
              placeholder="ej: GAMES/HYROX"
              className={campo}
            />
          </Etiqueta>

          <Etiqueta texto="Formato">
            <Selector
              name="format"
              required
              defaultValue={evento?.format ?? ""}
              className={selector}
            >
              {!evento && (
                <option value="" disabled>
                  Elige un formato…
                </option>
              )}
              <option value="carrera_hibrida">Carrera híbrida (HYROX)</option>
              <option value="crossfit">CrossFit</option>
            </Selector>
          </Etiqueta>

          <Etiqueta texto="Modalidad">
            <Selector
              name="eventType"
              defaultValue={evento?.event_type ?? "presencial"}
              className={selector}
            >
              <option value="presencial">Presencial</option>
              <option value="virtual">Virtual</option>
            </Selector>
          </Etiqueta>
        </div>

        <Etiqueta
          texto="Descripción"
          ayuda="Lo que va a leer un atleta antes de inscribirse."
        >
          <textarea
            name="description"
            rows={4}
            defaultValue={evento?.description ?? ""}
            className={campo}
          />
        </Etiqueta>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Afiche de la competencia</span>
          <ImagenDelEvento
            eventId={evento?.id ?? null}
            actual={evento?.logo_url ?? null}
          />
          {/* La portada sigue existiendo en la base y se conserva si ya estaba;
              no se pide porque la tarjeta del catálogo usa el afiche cuadrado y
              pedir dos imágenes para el mismo lugar solo confunde. */}
          <input
            type="hidden"
            name="coverUrl"
            value={evento?.cover_url ?? ""}
          />
        </div>
      </Seccion>

      <Seccion titulo="Cuándo">
        <div className="grid gap-4 sm:grid-cols-2">
          <Etiqueta texto="Empieza">
            <input
              name="startsAt"
              type="datetime-local"
              value={startsAt}
              onChange={(e) =>
                setStartsAt(siempreConHoraCero(startsAt, e.target.value))
              }
              className={campo}
            />
          </Etiqueta>
          <Etiqueta texto="Termina">
            <input
              name="endsAt"
              type="datetime-local"
              value={endsAt}
              onChange={(e) =>
                setEndsAt(siempreConHoraCero(endsAt, e.target.value))
              }
              className={campo}
            />
          </Etiqueta>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Etiqueta texto="Abren inscripciones">
            <input
              name="registrationOpensAt"
              type="datetime-local"
              value={registrationOpensAt}
              onChange={(e) =>
                setRegistrationOpensAt(
                  siempreConHoraCero(registrationOpensAt, e.target.value),
                )
              }
              className={campo}
            />
          </Etiqueta>
          <Etiqueta texto="Cierran inscripciones">
            <input
              name="registrationClosesAt"
              type="datetime-local"
              value={registrationClosesAt}
              onChange={(e) =>
                setRegistrationClosesAt(
                  siempreConHoraCero(registrationClosesAt, e.target.value),
                )
              }
              className={campo}
            />
          </Etiqueta>
        </div>

        <Etiqueta
          texto="Huso horario"
          ayuda="Todas las horas del evento se muestran en este huso, sin importar dónde esté quien mira."
        >
          <Selector
            value={huso}
            onChange={(e) => setHuso(e.target.value)}
            className={selector}
          >
            {[
              ...new Set([huso, ...PAISES.map((p) => husoSugerido(p.codigo))]),
            ].map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Selector>
        </Etiqueta>
      </Seccion>

      <Seccion titulo="Dónde">
        <div className="grid gap-4 sm:grid-cols-3">
          <Etiqueta texto="País">
            <Selector
              name="country"
              value={pais}
              onChange={(e) => {
                setPais(e.target.value);
                // Elegir el pais sugiere el huso, pero no lo impone: quien
                // organiza en un pais con varios husos lo corrige.
                if (e.target.value) setHuso(husoSugerido(e.target.value));
              }}
              className={selector}
            >
              <option value="">Sin especificar</option>
              {PAISES.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nombre}
                </option>
              ))}
            </Selector>
          </Etiqueta>
          <Etiqueta texto="Departamento o provincia">
            <input
              name="state"
              defaultValue={evento?.state ?? ""}
              className={campo}
            />
          </Etiqueta>
          <Etiqueta texto="Ciudad">
            <input
              name="city"
              defaultValue={evento?.city ?? ""}
              className={campo}
            />
          </Etiqueta>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Etiqueta texto="Sede">
            <input
              name="venue"
              defaultValue={evento?.venue ?? ""}
              placeholder="Coliseo Iván de Bedout"
              className={campo}
            />
          </Etiqueta>
          <Etiqueta texto="Dirección">
            <input
              name="address"
              defaultValue={evento?.address ?? ""}
              className={campo}
            />
          </Etiqueta>
        </div>
      </Seccion>

      <Seccion titulo="Contacto y redes">
        {/* Organiza + telefono (prefijo y numero juntos) en una fila, y las dos
            redes en otra: en escritorio son dos renglones en vez de cuatro. En
            celular cada bloque se apila. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Etiqueta texto="Organiza">
            <input
              name="organizerName"
              defaultValue={evento?.organizer_name ?? ""}
              className={campo}
            />
          </Etiqueta>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Etiqueta texto="Prefijo">
              <input
                name="organizerPhoneCountry"
                defaultValue={evento?.organizer_phone_country ?? prefijo}
                key={prefijo}
                placeholder="+57"
                className={`${campo} min-w-0`}
              />
            </Etiqueta>
            <Etiqueta texto="Teléfono">
              <input
                name="organizerPhone"
                defaultValue={evento?.organizer_phone ?? ""}
                className={`${campo} min-w-0`}
              />
            </Etiqueta>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Etiqueta texto="Instagram">
            <input
              name="instagram"
              defaultValue={evento?.instagram ?? ""}
              placeholder="@micompetencia"
              className={campo}
            />
          </Etiqueta>
          <Etiqueta texto="Sitio web">
            <input
              name="website"
              type="url"
              defaultValue={evento?.website ?? ""}
              placeholder="https://…"
              className={campo}
            />
          </Etiqueta>
        </div>
      </Seccion>

      <Seccion titulo="Participación">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Tallas de remera</legend>
          <p className="text-xs text-neutral-500">
            Sin ninguna marcada, no se le pide la talla a nadie al inscribirse.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {TALLAS.map((t) => (
              <label
                key={t}
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-700 px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  name={`talla-${t}`}
                  defaultChecked={evento?.shirt_sizes?.includes(t) ?? false}
                  className="accent-lime-400"
                />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
      </Seccion>

      {state.error && (
        <MensajeDeError>{state.error}</MensajeDeError>
      )}

      <div>
        <BotonDeEnvio
          pendienteTexto="Guardando…"
          mensajeDeCarga="Guardando la competencia…"
          className={claseDeBoton({ variante: "primary" })}
        >
          {submitLabel}
        </BotonDeEnvio>
      </div>
    </form>
  );
}
