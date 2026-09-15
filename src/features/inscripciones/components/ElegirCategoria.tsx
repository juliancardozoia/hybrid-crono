"use client";

import { useState, useTransition } from "react";
import { confirmarInscripcionIndividual, empezarInscripcion, type FormState } from "../actions";
import { Boton } from "@/shared/components/Boton";
import { MensajeDeError } from "@/shared/components/MensajeDeError";
import { CamposDeAtleta } from "./CamposDeAtleta";
import type { CampoDelFormulario, CategoriaParaInscribirse } from "../queries";
import type { Perfil } from "@/features/cuenta/queries";

/** "Julian Cardozo" -> {firstName: "Julian", lastName: "Cardozo"}. Heuristica
 * simple: el perfil guarda un solo campo de nombre y el tramite de inscripcion
 * pide nombre y apellido por separado. Es una PRECARGA, no una copia atada: el
 * atleta puede corregirla antes de confirmar. */
function separarNombre(fullName: string | null): { firstName: string; lastName: string } {
  const partes = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return { firstName: "", lastName: "" };
  return { firstName: partes[0], lastName: partes.slice(1).join(" ") };
}

/**
 * El primer paso de la inscripcion: elegir categoria.
 *
 * Es lo primero que se pide porque todo lo demas depende de eso — si hace falta
 * nombre de equipo, cuantos integrantes, cuanto sale y que campos se preguntan.
 * Un formulario que pide los datos antes de saber la categoria tiene que
 * adivinar, y adivina mal.
 *
 * INDIVIDUAL Y EQUIPO SON DOS FORMULARIOS DISTINTOS, A PROPOSITO:
 *
 * - Individual: el capitan ES el unico integrante. Elegir categoria, cargar
 *   los propios datos y enviar son, para esa persona, UN SOLO GESTO — antes
 *   eran tres pantallas (elegir categoria -> pantalla de "mis datos" ->
 *   "enviar inscripcion") para completar algo que un atleta hace de una
 *   sentada. Se fusiona todo en `confirmarInscripcionIndividual`.
 * - Equipo: el capitan necesita el ID de la inscripcion YA CREADO para poder
 *   invitar a sus compañeros por correo, y eso pasa en otro momento, no en la
 *   misma visita. Ahi se mantiene el paso minimo (categoria + nombre de
 *   equipo) seguido de la redireccion a `/inscripcion/[id]`.
 */
export function ElegirCategoria({
  categorias,
  tallas,
  campos,
  documentos,
  perfil,
}: {
  categorias: CategoriaParaInscribirse[];
  tallas: string[];
  campos: CampoDelFormulario[];
  documentos: Array<{ name: string; url: string; requiresAcceptance: boolean }>;
  perfil: Perfil | null;
}) {
  const [elegida, setElegida] = useState<string>("");
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const categoria = categorias.find((c) => c.id === elegida) ?? null;
  const esEquipo = (categoria?.teamSize ?? 1) > 1;
  const esIndividual = categoria !== null && !esEquipo;

  const camposDeLaCategoria = campos.filter(
    (c) => c.scope === "integrante" && (c.divisionId === null || c.divisionId === elegida),
  );

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);

    startTransition(async () => {
      const accion = esIndividual ? confirmarInscripcionIndividual : empezarInscripcion;
      const r: FormState = await accion({ error: null }, formData);
      if (r.error) setError(r.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <ul className="flex flex-col gap-2">
        {categorias.map((c) => {
          const sinCupo = c.cuposDisponibles !== null && c.cuposDisponibles <= 0;
          const seleccionada = c.id === elegida;

          return (
            <li key={c.id}>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors ${
                  seleccionada
                    ? "border-lime-400 bg-lime-400/5"
                    : "border-neutral-800"
                } ${sinCupo ? "cursor-not-allowed opacity-50" : "hover:border-neutral-700"}`}
              >
                <input
                  type="radio"
                  name="divisionId"
                  value={c.id}
                  disabled={sinCupo}
                  checked={seleccionada}
                  onChange={() => setElegida(c.id)}
                  className="mt-1 accent-lime-400"
                />
                <span className="flex-1">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-sm text-neutral-500">
                    {c.teamSize === 1
                      ? "Individual"
                      : `Equipos de ${c.teamSize}`}{" "}
                    · {SEXO[c.genderRule] ?? c.genderRule}
                    {(c.ageMin || c.ageMax) &&
                      ` · ${c.ageMin ?? "?"}–${c.ageMax ?? "?"} años`}
                    {c.level && ` · ${c.level}`}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-semibold">
                      {precio(c.priceCents, c.currency)}
                    </span>
                    {c.cuposDisponibles !== null && (
                      <span
                        className={
                          sinCupo ? "text-neutral-600" : "text-neutral-400"
                        }
                      >
                        {sinCupo ? "Sin cupos" : `${c.cuposDisponibles} cupos`}
                      </span>
                    )}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {esEquipo && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Nombre del equipo</span>
          <input
            name="teamName"
            required
            placeholder="Los Fuertes"
            className="rounded-xl border border-neutral-700 bg-transparent px-4 py-3 outline-none focus:border-lime-400"
          />
          <span className="text-xs text-neutral-500">
            Después vas a poder invitar a {categoria!.teamSize - 1}{" "}
            {categoria!.teamSize === 2 ? "compañero" : "compañeros"} con su
            correo.
          </span>
        </label>
      )}

      {esIndividual && (
        <div className="flex flex-col gap-4 border-t border-neutral-800 pt-6">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase">
            Tus datos
          </h2>
          <CamposDeAtleta
            valores={{
              ...separarNombre(perfil?.fullName ?? null),
              birthDate: perfil?.birthDate ?? null,
              phone: perfil?.phone ?? null,
              country: perfil?.country ?? null,
              documentId: perfil?.documentId ?? null,
              stateProvince: perfil?.stateProvince ?? null,
              box: perfil?.box ?? null,
            }}
            tallas={tallas}
            campos={camposDeLaCategoria}
            documentos={documentos}
            soloEsenciales
          />
        </div>
      )}

      {error && <MensajeDeError>{error}</MensajeDeError>}

      <div>
        <Boton
          type="submit"
          disabled={!elegida}
          cargando={pendiente}
          textoCargando={esIndividual ? "Confirmando…" : "Creando…"}
          variante="primary"
        >
          {esIndividual ? "Confirmar inscripción" : "Continuar"}
        </Boton>
      </div>
    </form>
  );
}

const SEXO: Record<string, string> = {
  male: "Masculino",
  female: "Femenino",
  mixed: "Mixta",
  any: "Abierta",
};

function precio(cents: number | null, moneda: string): string {
  if (cents === null || cents === 0) return "Sin costo";
  // Sin decimales: los pesos de la region no los usan en un precio de
  // inscripcion, y "150.000" se lee mejor que "150.000,00".
  return `${new Intl.NumberFormat("es", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(cents / 100)}`;
}
