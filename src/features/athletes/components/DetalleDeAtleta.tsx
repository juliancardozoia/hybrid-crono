"use client";

import { useActionState } from "react";
import { actualizarEquipo, type FormState } from "../actions";
import { useCargaMientras } from "@/shared/components/Carga";
import { useCerrarAlGuardar } from "@/shared/components/Modal";
import { Selector } from "@/shared/components/Selector";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import type { TeamWithMembers } from "@/features/events/config/queries";

const selector = "w-full py-2.5 text-sm";

const SEXO: Record<string, string> = {
  male: "Masculino",
  female: "Femenino",
  other: "Otro",
};

export interface DivisionParaDetalle {
  id: string;
  name: string;
  teamSize: number;
  /** `division_registration.allows_division_change` de ESTA categoria. Rige
   *  para un equipo que hoy corre en ella: si es false, este equipo no se
   *  puede mover de categoria desde acá. */
  permiteCambioCategoria: boolean;
}

const inicial: FormState = { error: null };

/**
 * El detalle de un equipo, DESPLEGADO EN EL LUGAR — no un modal.
 *
 * UNA TARJETA COMPACTA DE SOLO LECTURA, no un formulario. Los datos
 * personales del atleta (nombre, documento, contacto…) no se editan acá — se
 * cargaron al inscribirlo y esta pantalla no es donde se corrigen.
 *
 * NO REPITE NOMBRE, BANDERA NI LOS BOTONES DE COPIAR/WHATSAPP: la fila
 * principal de la grilla ya los muestra, dos veces seria redundante. Lo que
 * el detalle agrega es lo que la fila NO tiene lugar para mostrar —documento,
 * nacimiento, sexo, provincia— y el correo/telefono en texto plano, ya que acá
 * no hace falta el boton de copiar o el enlace de WhatsApp, alcanza con
 * leerlos.
 *
 * Lo único que se puede accionar, al final, son dos cosas:
 *
 *   Categoría        SOLO si la categoría ACTUAL del equipo tiene habilitado
 *                    el cambio (`permiteCambioCategoria`, el toggle de
 *                    "Habilitar cambio de categoría" en el modal de la
 *                    categoría). Si no, el campo ni se muestra — la garantía
 *                    real la revalida `actualizarEquipo` en el servidor.
 *   Estado de registro  Siempre visible: aprobar o dejar pendiente un
 *                    registro es una decisión operativa, no un dato del
 *                    atleta, y no depende de ningún toggle.
 */
export function DetalleDeAtleta({
  eventId,
  team,
  divisiones,
  alCerrar,
}: {
  eventId: string;
  team: TeamWithMembers;
  divisiones: DivisionParaDetalle[];
  alCerrar: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    actualizarEquipo,
    inicial,
  );
  const formId = `detalle-equipo-${team.id}`;
  useCargaMientras(pending, "Guardando…");
  useCerrarAlGuardar(pending, state.error, alCerrar);

  const categoriaActual = divisiones.find((d) => d.id === team.division_id);
  const permiteCambio = categoriaActual?.permiteCambioCategoria ?? false;

  return (
    <div className="flex w-full flex-col gap-5 p-1">
      <div className="grid grid-cols-2 gap-3">
        <DatoFijo etiqueta="Dorsal" valor={String(team.bib_number)} />
        <DatoFijo etiqueta="Equipo" valor={team.name ?? "Individual"} />
      </div>

      {team.members.length === 0 ? (
        <p className="text-sm text-neutral-500">Sin integrantes.</p>
      ) : (
        <div className="flex flex-col">
          {team.members.map((m, i) => (
            <TarjetaDeIntegrante key={m.id} miembro={m} primero={i === 0} />
          ))}
        </div>
      )}

      <form
        id={formId}
        action={formAction}
        className="flex flex-col gap-3 border-t border-neutral-800 pt-5 text-left"
      >
        <input type="hidden" name="eventId" value={eventId} />
        <input type="hidden" name="teamId" value={team.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          {permiteCambio && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Categoría</span>
              <Selector
                name="divisionId"
                defaultValue={team.division_id}
                className={selector}
              >
                {divisiones.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Selector>
            </label>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Estado de registro</span>
            <Selector
              name="estado"
              defaultValue={team.approved ? "aprobado" : "pendiente"}
              className={selector}
            >
              <option value="aprobado">Aprobado</option>
              <option value="pendiente">Pendiente</option>
            </Selector>
          </label>
        </div>

        {state.error && (
          <MensajeDeError>{state.error}</MensajeDeError>
        )}
      </form>

      <div className="flex justify-end gap-2 border-t border-neutral-800 pt-5">
        <button
          type="button"
          onClick={alCerrar}
          className="rounded-xl border border-neutral-700 px-4 py-2.5 text-sm hover:bg-neutral-900"
        >
          Cerrar
        </button>
        <button
          type="submit"
          form={formId}
          disabled={pending}
          className="rounded-xl bg-lime-400 px-5 py-2.5 text-sm font-bold text-lime-950 transition-colors hover:bg-lime-300 disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}

function DatoFijo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 px-3 py-2">
      <p className="text-xs text-neutral-500">{etiqueta}</p>
      <p className="truncate text-sm font-medium">{valor}</p>
    </div>
  );
}

/**
 * Lo esencial de un integrante, en una tarjeta chica de solo lectura: nombre,
 * documento, fecha de nacimiento, sexo y provincia en una grilla apretada, más
 * correo y teléfono con el mismo copiar/WhatsApp que ya usa la grilla — no
 * hace falta escribir el número a mano para contactarlo.
 */
function TarjetaDeIntegrante({
  miembro,
  primero,
}: {
  miembro: TeamWithMembers["members"][number];
  /** El primero no lleva separador arriba: nada de que separarse todavia. */
  primero: boolean;
}) {
  return (
    <dl
      className={`grid w-full grid-cols-2 gap-x-3 gap-y-2 py-3 text-xs sm:grid-cols-3 lg:grid-cols-6 ${
        primero ? "" : "border-t border-neutral-800"
      }`}
    >
      <Campo etiqueta="Documento" valor={miembro.document_id} />
      <Campo etiqueta="Nacimiento" valor={miembro.birth_date} />
      <Campo
        etiqueta="Sexo"
        valor={miembro.gender ? (SEXO[miembro.gender] ?? miembro.gender) : null}
      />
      <Campo etiqueta="Provincia / Estado" valor={miembro.state_province} />
      <Campo etiqueta="Correo" valor={miembro.email} />
      <Campo etiqueta="Teléfono" valor={miembro.phone} />
    </dl>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-neutral-600">{etiqueta}</dt>
      <dd className="truncate text-neutral-300">{valor ?? "—"}</dd>
    </div>
  );
}
