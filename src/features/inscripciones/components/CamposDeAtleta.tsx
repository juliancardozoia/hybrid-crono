"use client";

import { useState } from "react";
import { Selector } from "@/shared/components/Selector";
import { PAISES } from "@/shared/utils/paises";
import { etiquetaSubdivision } from "@/shared/utils/subdivision";
import type { CampoDelFormulario } from "../queries";

const campo =
  "w-full rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400";
const selector = "w-full py-3";

/**
 * Los campos de "mis datos": nombre, apellido, nacimiento, sexo, telefono,
 * talla, los campos que agrego el organizador, y aceptar terminos.
 *
 * Vive aparte porque lo usan DOS pantallas con el mismo formulario pero
 * distinto envoltorio: `MisDatos` (categorias de equipo, editando un
 * integrante que ya existe) y el paso "elegir categoria" para individual
 * (donde el integrante todavia no existe -- se crea recien al confirmar).
 * Mismo motivo por el que el proyecto no duplica el reductor de tiempos: dos
 * copias del mismo formulario terminan divergiendo.
 */
export function CamposDeAtleta({
  valores,
  tallas,
  campos,
  documentos,
  soloEsenciales = false,
}: {
  valores?: {
    firstName?: string | null;
    lastName?: string | null;
    birthDate?: string | null;
    gender?: string | null;
    phone?: string | null;
    shirtSize?: string | null;
    country?: string | null;
    documentId?: string | null;
    stateProvince?: string | null;
    box?: string | null;
    answers?: Record<string, string> | null;
    aceptado?: boolean;
  };
  tallas: string[];
  campos: CampoDelFormulario[];
  documentos: Array<{ name: string; url: string; requiresAcceptance: boolean }>;
  /**
   * Para la inscripcion rapida. Nombre, apellido, pais y terminos siempre se
   * piden -- son lo unico que `save_member_data` exige para marcar el
   * integrante como completo.
   *
   * Nacimiento, telefono, documento, provincia/estado y box NUNCA SE
   * MUESTRAN en este modo: si el perfil ya los tiene viajan ocultos (no se
   * repregunta lo que el atleta ya cargo en otra competencia -- el perfil es
   * UNO SOLO para toda la plataforma); si el perfil TODAVIA NO los tiene, se
   * DIFIEREN igual -- no se le pide a un atleta nuevo algo que un atleta
   * viejo no tiene que repetir. Se completan despues en "Mis datos" (mismo
   * formulario, sin este flag). Sexo, talla y los campos del organizador
   * siguen la misma regla: nunca viven en el perfil, siempre se difieren.
   */
  soloEsenciales?: boolean;
}) {
  const respuestas = valores?.answers ?? {};
  const [pais, setPais] = useState(valores?.country ?? "");

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Nombre</span>
          <input
            name="firstName"
            required
            defaultValue={valores?.firstName ?? ""}
            className={campo}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Apellido</span>
          <input
            name="lastName"
            required
            defaultValue={valores?.lastName ?? ""}
            className={campo}
          />
        </label>
      </div>

      {/* Pais: sin esto, la bandera de la grilla del organizador (y de la
          lista de largada / leaderboard publico) nunca puede mostrarse para
          nadie que se inscriba solo -- antes solo lo pedia el alta manual del
          organizador. */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">País</span>
        <Selector
          name="country"
          required
          value={pais}
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
        </Selector>
      </label>

      {/* Nacimiento y telefono. En modo rapido: oculto si el perfil lo tiene,
          NADA (ni se pregunta) si no lo tiene. Fuera de soloEsenciales
          (editar) siempre visible. */}
      {soloEsenciales ? (
        <>
          {valores?.birthDate && (
            <input type="hidden" name="birthDate" value={valores.birthDate} />
          )}
          {valores?.phone && <input type="hidden" name="phone" value={valores.phone} />}
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Fecha de nacimiento</span>
            <input
              name="birthDate"
              type="date"
              defaultValue={valores?.birthDate ?? ""}
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Teléfono</span>
            <input name="phone" defaultValue={valores?.phone ?? ""} className={campo} />
          </label>
        </div>
      )}

      {/* Documento y provincia/estado: misma regla. */}
      {soloEsenciales ? (
        <>
          {valores?.documentId && (
            <input type="hidden" name="documentId" value={valores.documentId} />
          )}
          {valores?.stateProvince && (
            <input type="hidden" name="stateProvince" value={valores.stateProvince} />
          )}
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Documento (DNI)</span>
            <input
              name="documentId"
              defaultValue={valores?.documentId ?? ""}
              className={campo}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{etiquetaSubdivision(pais)}</span>
            <input
              name="stateProvince"
              defaultValue={valores?.stateProvince ?? ""}
              className={campo}
            />
          </label>
        </div>
      )}

      {/* Box: misma regla, y siempre opcional. */}
      {soloEsenciales ? (
        valores?.box && <input type="hidden" name="box" value={valores.box} />
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Box (opcional)</span>
          <input name="box" defaultValue={valores?.box ?? ""} className={campo} />
        </label>
      )}

      {!soloEsenciales && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Sexo</span>
              <Selector name="gender" defaultValue={valores?.gender ?? ""} className={selector}>
                <option value="">Sin especificar</option>
                <option value="male">Masculino</option>
                <option value="female">Femenino</option>
                <option value="other">Otro</option>
              </Selector>
            </label>

            {/* Sin tallas configuradas el evento no entrega remera: no se pregunta. */}
            {tallas.length > 0 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Talla de remera</span>
                <Selector name="shirtSize" defaultValue={valores?.shirtSize ?? ""} className={selector}>
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
                  type={c.type === "numero" ? "number" : c.type === "fecha" ? "date" : "text"}
                  defaultValue={respuestas[c.key] ?? ""}
                  className={campo}
                />
              )}
            </label>
          ))}
        </>
      )}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="acceptTerms"
          defaultChecked={valores?.aceptado ?? false}
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
    </>
  );
}
