"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManage } from "@/features/events/lib/access";
import { aKilos } from "@/features/events/lib/carga";
import type { GenderRule, LoadUnit } from "@/lib/supabase/types";

export interface FormState {
  error: string | null;
}

const OK: FormState = { error: null };

function refrescar(eventId: string) {
  revalidatePath(`/panel/eventos/${eventId}`, "layout");
  revalidatePath(`/panel/asistente/${eventId}`, "layout");
}

/**
 * Guarda TODA la categoria: datos basicos, cupo y puntuacion, en un solo
 * envio. Antes eran DOS formularios con DOS botones "Guardar" adentro del
 * mismo modal —uno para nombre/integrantes/sexo/edad/circuito
 * (`updateDivision`), otro para cupo y puntuacion (`guardarCupoYPuntuacion`)—
 * y esta funcion los reemplaza a los dos: un modal tiene un solo Guardar,
 * nunca mas de uno.
 *
 * EL CUPO VACIO SIGNIFICA ILIMITADO, y por eso se guarda como NULL y no como
 * cero: cero es un cupo real —una categoria cerrada— y confundirlos dejaria
 * fuera a todo el mundo sin que nadie entienda por que.
 *
 * La fila de `division_registration` se crea sola la primera vez. Es la tabla
 * que ya guarda precio y ventana de inscripcion; el cupo vive ahi y no en
 * `divisions` porque es un dato del TRAMITE, no de la categoria: una categoria
 * sigue existiendo cuando las inscripciones cierran.
 */
export async function guardarCategoria(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const divisionId = String(formData.get("divisionId") ?? "");
  // El campo solo se pinta si compite mas de una persona. Sin este marcador,
  // guardar una categoria individual escribiria `false` sobre el permiso de
  // una de equipo si alguien reusara la accion.
  const esEquipo = formData.get("esEquipo") === "1";

  await requireManage(eventId);

  // --- Datos basicos -------------------------------------------------------
  const name = String(formData.get("name") ?? "").trim();
  const courseTemplateId = String(formData.get("courseTemplateId") ?? "");
  const teamSize = Number(formData.get("teamSize") ?? 1);
  const genderRule = String(formData.get("genderRule") ?? "any") as GenderRule;
  const ageMin = formData.get("ageMin") ? Number(formData.get("ageMin")) : null;
  const ageMax = formData.get("ageMax") ? Number(formData.get("ageMax")) : null;

  if (name.length < 2) return { error: "Escribe un nombre a la división." };
  if (genderRule === "mixed" && teamSize < 2) {
    return { error: "Una división mixta necesita equipos de 2 o más." };
  }
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    return { error: "La edad mínima no puede ser mayor que la máxima." };
  }

  // --- Cupo y puntuacion -----------------------------------------------
  const cupoBruto = String(formData.get("capacity") ?? "").trim();
  const scoringTableId =
    String(formData.get("scoringTableId") ?? "").trim() || null;

  let capacity: number | null = null;
  if (cupoBruto) {
    const n = Number(cupoBruto);
    if (!Number.isInteger(n) || n < 1) {
      return {
        error: "El límite de registros es un número entero mayor que cero.",
      };
    }
    capacity = n;
  }

  const supabase = await createClient();

  const { error: errorDivision } = await supabase
    .from("divisions")
    .update({
      name,
      course_template_id: courseTemplateId || null,
      team_size: teamSize,
      gender_rule: genderRule,
      age_min: ageMin,
      age_max: ageMax,
      scoring_table_id: scoringTableId,
    })
    .eq("id", divisionId);

  if (errorDivision)
    return {
      error: errorDivision.message || "No se pudo guardar la división.",
    };

  const { error: errorCupo } = await supabase
    .from("division_registration")
    .upsert(
      {
        division_id: divisionId,
        event_id: eventId,
        capacity,
        ...(esEquipo
          ? { allows_member_swap: formData.get("permiteCambios") === "on" }
          : {}),
      },
      { onConflict: "division_id" },
    );

  if (errorCupo)
    return { error: errorCupo.message || "No se pudo guardar el cupo." };

  refrescar(eventId);
  return OK;
}

/**
 * Agrega un movimiento al estandar de la categoria.
 *
 * El peso se guarda SIEMPRE en kilos y se recuerda en que unidad lo escribio el
 * organizador. Sin lo segundo, quien programo "95 lb" —el numero redondo del
 * reglamento— lo veria de vuelta como "43,09 kg" y creeria que la pantalla se
 * equivoco.
 */
export async function agregarMovimientoDeCategoria(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const eventId = String(formData.get("eventId") ?? "");
  const divisionId = String(formData.get("divisionId") ?? "");
  const movementId = String(formData.get("movementId") ?? "").trim();
  const personalizado = String(formData.get("customName") ?? "").trim();
  const cargaBruta = String(formData.get("load") ?? "").trim();
  const unidad =
    (String(formData.get("loadUnit") ?? "kg") as LoadUnit) === "lb"
      ? "lb"
      : "kg";
  const spec = String(formData.get("spec") ?? "").trim() || null;

  await requireManage(eventId);

  if (!movementId && !personalizado) {
    return { error: "Elige un movimiento o escribe uno." };
  }

  let loadKg: number | null = null;
  if (cargaBruta) {
    const n = Number(cargaBruta.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return { error: "El peso no es válido." };
    loadKg = aKilos(n, unidad);
  }

  const supabase = await createClient();

  const { data: ultimo } = await supabase
    .from("division_movements")
    .select("order_index")
    .eq("division_id", divisionId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("division_movements").insert({
    division_id: divisionId,
    event_id: eventId,
    order_index: (ultimo?.order_index ?? -1) + 1,
    // La base exige uno de los dos y solo uno: el CHECK
    // `division_movement_tiene_nombre` lo garantiza.
    movement_id: movementId || null,
    custom_name: movementId ? null : personalizado,
    load_kg: loadKg,
    load_unit: unidad,
    spec,
  });

  if (error) {
    if (error.code === "23505")
      return { error: "Ese movimiento ya está en la categoría." };
    return { error: error.message || "No se pudo agregar el movimiento." };
  }

  refrescar(eventId);
  return OK;
}

export async function quitarMovimientoDeCategoria(
  eventId: string,
  id: string,
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();
  const { error } = await supabase
    .from("division_movements")
    .delete()
    .eq("id", id);
  if (error) return { error: "No se pudo quitar el movimiento." };

  refrescar(eventId);
  return OK;
}
