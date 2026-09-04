"use server";

import { revalidatePath } from "next/cache";
import { requireManage } from "@/features/events/lib/access";
import { createClient } from "@/lib/supabase/server";
import type { AthleteGender } from "@/lib/supabase/types";
import {
  buildImportPlan,
  type DivisionInfo,
  type ImportPlan,
  type PlannedTeam,
} from "./lib/import";

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
  const { data } = await supabase
    .from("teams")
    .select("bib_number")
    .eq("event_id", eventId);
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
    return {
      error: "Sube un archivo CSV o pega el contenido.",
      plan: null,
      csv: null,
    };
  }

  const divisiones = await cargarDivisiones(eventId);
  if (divisiones.length === 0) {
    return {
      error:
        "Primero crea al menos una categoría: el CSV se asigna por nombre de categoría.",
      plan: null,
      csv: null,
    };
  }

  const plan = buildImportPlan(csv, divisiones, {
    existingBibs: await dorsalesUsados(eventId),
  });

  return { error: null, plan, csv };
}

/**
 * Paso 2: escribe. Va por la funcion import_teams, que corre todo en una
 * transaccion: si algo falla, no queda medio padron cargado.
 */
export async function confirmImport(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  await requireManage(eventId);

  const csv = String(formData.get("csv") ?? "");
  if (!csv.trim())
    return { error: "Se perdió el contenido del archivo. Subilo de nuevo." };

  // El plan se recalcula en el servidor en vez de confiar en el que viajo al
  // navegador: si el cliente lo manipulara, entrarian dorsales o divisiones que
  // nunca se validaron.
  const divisiones = await cargarDivisiones(eventId);
  const plan = buildImportPlan(csv, divisiones, {
    existingBibs: await dorsalesUsados(eventId),
  });

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
    return { error: traducirImport(error) };
  }

  refrescar(eventId);
  return { error: null };
}

/**
 * Igual que `traducir()`, pero para el error de `import_teams`: la carga es
 * TODO O NADA, así que un solo documento o correo repetido en la planilla —o
 * contra alguien que ya estaba cargado— hace fallar el lote entero, y el
 * mensaje tiene que decir cuál de las tres reglas fue.
 */
function traducirImport(error: { code?: string; message?: string } | null): string {
  if (error?.code === "23505") {
    if (error.message?.includes("athletes_document_unico")) {
      return "Hay un documento repetido en la planilla, o ya está cargado. No se importó nada.";
    }
    if (error.message?.includes("athletes_email_unico")) {
      return "Hay un correo repetido en la planilla, o ya está cargado. No se importó nada.";
    }
    return "Hay un dorsal repetido. Vuelve a generar la vista previa.";
  }
  return "No se pudo importar. No se cargó nada.";
}

export interface IntegranteManual {
  firstName: string;
  lastName: string;
  email: string;
  birthDate: string | null;
  gender: AthleteGender | null;
  country: string | null;
  documentId: string | null;
  stateProvince: string | null;
}

function traducir(error: { code?: string; message?: string } | null): string {
  if (!error) return "No se pudo guardar.";
  if (error.code === "23505") {
    // Los nombres de indice son especificos a proposito, para no devolver el
    // mismo "ya existe un registro con esos datos" ante tres causas
    // distintas: dorsal repetido, documento repetido, correo repetido.
    if (error.message?.includes("athletes_document_unico")) {
      return "Ya hay un atleta con ese documento en esta competencia.";
    }
    if (error.message?.includes("athletes_email_unico")) {
      return "Ya hay un atleta con ese correo en esta competencia.";
    }
    return "Ya existe un registro con esos datos.";
  }
  if (error.code === "23514") return "Algún valor está fuera de rango.";
  if (error.code === "insufficient_privilege")
    return "No tienes permiso para esta operación.";
  return error.message || "No se pudo guardar.";
}

/**
 * Alta manual, UNIFICADA con el sistema de inscripciones.
 *
 * Antes esta funcion escribia derecho en `athletes`/`teams` via `import_teams`
 * —el mismo RPC que usa la importacion CSV, pero para un solo atleta—, un
 * segundo camino por el que podia nacer un equipo. Ahora llama a
 * `admin_create_registration()`, que arma la inscripcion con los datos que ya
 * tenemos y confirma con la MISMA funcion que usa el portal publico
 * (`confirm_registration`): un solo lugar donde nace un equipo, sea cual sea
 * la puerta por la que entro.
 *
 * QUEDA CONFIRMADO DIRECTO, sin pedir pago aunque la categoria tenga precio:
 * es la organizacion registrando a alguien que ya esta ahi, no un tramite por
 * el portal.
 *
 * La importacion CSV (`confirmImport`, mas abajo) sigue por `import_teams` a
 * proposito: es una carga MASIVA de un padron ya armado, no una persona
 * completando su propio tramite — no tiene el mismo problema que resolvia
 * unificar el alta de a uno.
 */
export async function crearRegistroManual(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const divisionId = String(formData.get("divisionId") ?? "");
  const teamName = String(formData.get("teamName") ?? "").trim() || null;
  const teamSize = Number(formData.get("teamSize") ?? 1);

  if (!divisionId) return { error: "Elige una categoría." };
  if (!Number.isInteger(teamSize) || teamSize < 1)
    return { error: "Categoría inválida." };

  const integrantes: IntegranteManual[] = [];
  for (let i = 0; i < teamSize; i++) {
    const firstName = String(formData.get(`firstName_${i}`) ?? "").trim();
    const lastName = String(formData.get(`lastName_${i}`) ?? "").trim();
    const email = String(formData.get(`email_${i}`) ?? "").trim();
    const country = String(formData.get(`country_${i}`) ?? "").trim();
    const documentId = String(formData.get(`documentId_${i}`) ?? "").trim();

    if (!firstName || !lastName) {
      return { error: `Completa nombre y apellido del integrante ${i + 1}.` };
    }
    if (!email) return { error: `Falta el correo del integrante ${i + 1}.` };
    if (!country) return { error: `Falta el país del integrante ${i + 1}.` };
    if (!documentId)
      return { error: `Falta el documento del integrante ${i + 1}.` };

    integrantes.push({
      firstName,
      lastName,
      email,
      birthDate: String(formData.get(`birthDate_${i}`) ?? "").trim() || null,
      gender: (String(formData.get(`gender_${i}`) ?? "") ||
        null) as AthleteGender | null,
      country,
      documentId,
      stateProvince:
        String(formData.get(`stateProvince_${i}`) ?? "").trim() || null,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_registration", {
    p_division_id: divisionId,
    // "" y NULL dan lo mismo del lado de la funcion (`nullif(trim(coalesce(...
    // , '')), '')`), asi que no hace falta pasar null: el tipo generado no lo
    // acepta porque el parametro SQL no tiene default.
    p_team_name: teamName ?? "",
    p_integrantes: integrantes as never,
  });

  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return { error: null };
}

export async function deleteTeam(
  eventId: string,
  teamId: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  // Los atletas quedan: pueden estar en otro equipo, y borrarlos en cascada
  // seria destruir datos que el organizador no pidio borrar.
  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  if (error) return { error: traducir(error) };

  refrescar(eventId);
  return { error: null };
}
