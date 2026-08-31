"use server";

import { revalidatePath } from "next/cache";
import { requireManage } from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";
import type { AthleteGender } from "@/lib/supabase/types";
import { buildImportPlan, type DivisionInfo, type ImportPlan, type PlannedTeam } from "./lib/import";

export interface FormState {
  error: string | null;
}

export interface PreviewState {
  error: string | null;
  plan: ImportPlan | null;
  /** El CSV se conserva para poder confirmar sin volver a subir el archivo. */
  csv: string | null;
}

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
}

async function cargarDivisiones(eventId: string): Promise<DivisionInfo[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("divisions")
    .select("id, name, team_size, gender_rule")
    .eq("event_id", eventId);

  return (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    teamSize: d.team_size,
    genderRule: d.gender_rule,
  }));
}

async function dorsalesUsados(eventId: string): Promise<number[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("teams").select("bib_number").eq("event_id", eventId);
  return (data ?? []).map((t) => t.bib_number);
}

/**
 * Paso 1 del import: arma el plan y lo devuelve para que el organizador lo mire.
 * No escribe nada. Importar mal 300 atletas la noche antes de la competencia es
 * mucho mas caro que revisar una tabla.
 */
export async function previewImport(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const archivo = formData.get("archivo");
  let csv = String(formData.get("csv") ?? "");

  if (archivo instanceof File && archivo.size > 0) {
    if (archivo.size > 2_000_000) {
      return { error: "El archivo supera los 2 MB.", plan: null, csv: null };
    }
    csv = await archivo.text();
  }

  if (!csv.trim()) {
    return { error: "Sube un archivo CSV o pega el contenido.", plan: null, csv: null };
  }

  const divisiones = await cargarDivisiones(eventId);
  if (divisiones.length === 0) {
    return {
      error: "Primero crea al menos una división: el CSV se asigna por nombre de división.",
      plan: null,
      csv: null,
    };
  }

  const plan = buildImportPlan(csv, divisiones, { existingBibs: await dorsalesUsados(eventId) });

  return { error: null, plan, csv };
}

/**
 * Paso 2: escribe. Va por la funcion import_teams, que corre todo en una
 * transaccion: si algo falla, no queda medio padron cargado.
 */
export async function confirmImport(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const csv = String(formData.get("csv") ?? "");
  if (!csv.trim()) return { error: "Se perdió el contenido del archivo. Subilo de nuevo." };

  // El plan se recalcula en el servidor en vez de confiar en el que viajo al
  // navegador: si el cliente lo manipulara, entrarian dorsales o divisiones que
  // nunca se validaron.
  const divisiones = await cargarDivisiones(eventId);
  const plan = buildImportPlan(csv, divisiones, { existingBibs: await dorsalesUsados(eventId) });

  if (plan.teams.length === 0) {
    return { error: "No hay nada válido para importar." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("import_teams", {
    p_event_id: eventId,
    p_teams: plan.teams.map((t: PlannedTeam) => ({
      divisionId: t.divisionId,
      bibNumber: t.bibNumber,
      name: t.name,
      members: t.members,
    })),
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "Hay un dorsal repetido. Vuelve a generar la vista previa."
          : "No se pudo importar. No se cargó nada.",
    };
  }

  refrescar(eventId);
  return { error: null };
}

/** Alta manual, para los que llegan sueltos el día del evento. */
export async function createAthleteTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const divisionId = String(formData.get("divisionId") ?? "");
  const gender = (String(formData.get("gender") ?? "") || null) as AthleteGender | null;
  const birthDate = String(formData.get("birthDate") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const bibRaw = String(formData.get("bibNumber") ?? "").trim();

  if (!firstName || !lastName) return { error: "Completa nombre y apellido." };
  if (!divisionId) return { error: "Elige una división." };

  const usados = await dorsalesUsados(eventId);
  let bib: number;

  if (bibRaw) {
    bib = Number(bibRaw);
    if (!Number.isInteger(bib) || bib <= 0) return { error: "El dorsal no es válido." };
    if (usados.includes(bib)) return { error: `El dorsal ${bib} ya está usado.` };
  } else {
    bib = Math.max(0, ...usados) + 1;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("import_teams", {
    p_event_id: eventId,
    p_teams: [
      {
        divisionId,
        bibNumber: bib,
        name: null,
        members: [{ firstName, lastName, gender, birthDate, email, phone: null, externalRef: null }],
      },
    ],
  });

  if (error) return { error: "No se pudo crear el atleta." };

  refrescar(eventId);
  return { error: null };
}

export async function deleteTeam(eventId: string, teamId: string): Promise<void> {
  await requireManage(eventId);
  const supabase = await createClient();

  // Los atletas quedan: pueden estar en otro equipo, y borrarlos en cascada
  // seria destruir datos que el organizador no pidio borrar.
  await supabase.from("teams").delete().eq("id", teamId);
  refrescar(eventId);
}
