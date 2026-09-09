"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManage } from "@/features/events/lib/access";
import { aKilos } from "@/shared/unidades/carga";
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
 * Guarda TODA la categoria: datos basicos, cupo, puntuacion Y los pesos de
 * sus movimientos, en un solo envio. Antes eran DOS formularios con DOS
 * botones "Guardar" adentro del mismo modal —uno para nombre/integrantes/
 * sexo/edad/circuito (`updateDivision`), otro para cupo y puntuacion
 * (`guardarCupoYPuntuacion`)— y esta funcion los reemplaza a los dos: un
 * modal tiene un solo Guardar, nunca mas de uno.
 *
 * LOS PESOS DE LOS MOVIMIENTOS ENTRAN CON EL MISMO ENVIO. Corregir "43" por
 * "45" tenia su PROPIA accion y su PROPIO boton "Actualizar" por fila —una
 * pared de guardados sueltos, cada uno con su propio viaje al servidor. Los
 * campos `carga_<id>` de cada movimiento (y `unidadPeso`, la unidad de TODA
 * la categoria) viven fuera de la etiqueta `<form>` pero apuntan a ella con
 * el atributo HTML `form={id}` —el mismo truco que ya usa `BotonesDeModal`
 * para vivir afuera del `<form>`— asi que el UNICO Guardar del modal los
 * incluye sin que el organizador note la diferencia.
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
  // Una sola unidad para toda la categoria, elegida arriba de la lista de
  // movimientos. Si el evento no es CrossFit el campo no existe y esto cae en
  // "kg" sin que importe: no hay ningun `carga_*` que convertir con el.
  const unidadPeso =
    (String(formData.get("unidadPeso") ?? "kg") as LoadUnit) === "lb"
      ? "lb"
      : "kg";

  await requireManage(eventId);

  // --- Datos basicos -------------------------------------------------------
  const name = String(formData.get("name") ?? "").trim();
  const courseTemplateId = String(formData.get("courseTemplateId") ?? "");
  const teamSize = Number(formData.get("teamSize") ?? 1);
  const genderRule = String(formData.get("genderRule") ?? "any") as GenderRule;
  const ageMin = formData.get("ageMin") ? Number(formData.get("ageMin")) : null;
  const ageMax = formData.get("ageMax") ? Number(formData.get("ageMax")) : null;

  if (name.length < 2) return { error: "Escribe un nombre a la categoría." };
  if (genderRule === "mixed" && teamSize < 2) {
    return { error: "Una categoría mixta necesita equipos de 2 o más." };
  }
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    return { error: "La edad mínima no puede ser mayor que la máxima." };
  }

  // --- Cupo y puntuacion -----------------------------------------------
  const cupoBruto = String(formData.get("capacity") ?? "").trim();

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
    })
    .eq("id", divisionId);

  if (errorDivision)
    return {
      error: errorDivision.message || "No se pudo guardar la categoría.",
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
        // A diferencia de "permiteCambios", esto no depende de si compite mas
        // de una persona: mover un atleta de categoria no tiene nada que ver
        // con cuantos integrantes tenga.
        allows_division_change: formData.get("permiteCambioCategoria") === "on",
      },
      { onConflict: "division_id" },
    );

  if (errorCupo)
    return { error: errorCupo.message || "No se pudo guardar el cupo." };

  // --- Pesos de los movimientos --------------------------------------------
  // No hay un `<input name="movimientoId[]">` con la lista: se recorre la
  // FormData buscando `carga_<id>`, que es exactamente lo que cada fila
  // manda via `form={divisionId del modal}`. Vacio borra el peso (vuelve a
  // "sin carga"), nunca "cero kilos" — mismo criterio que el resto del
  // esquema (ver `division_segment_specs`).
  const actualizaciones: PromiseLike<{ error: unknown }>[] = [];
  for (const [campo, valor] of formData.entries()) {
    if (!campo.startsWith("carga_") || typeof valor !== "string") continue;
    const movimientoId = campo.slice("carga_".length);
    const bruto = valor.trim();

    let loadKg: number | null = null;
    if (bruto) {
      const n = Number(bruto.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        return { error: "El peso no es válido." };
      }
      loadKg = aKilos(n, unidadPeso);
    }

    actualizaciones.push(
      supabase
        .from("division_movements")
        .update({ load_kg: loadKg, load_unit: unidadPeso })
        .eq("id", movimientoId),
    );
  }

  if (actualizaciones.length > 0) {
    const resultados = await Promise.all(actualizaciones);
    if (resultados.some((r) => r.error))
      return { error: "No se pudo guardar el peso de un movimiento." };
  }

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

/**
 * Sube o baja un movimiento en la lista de la categoria.
 *
 * Es el orden en que se publica: "Thruster, Pull-up, Box Jump" se lee como el
 * organizador lo escribio y no como salio de la base. Intercambia el
 * `order_index` con el vecino, y NO hay unique sobre (division_id,
 * order_index), asi que dos updates sueltos no chocan a mitad de camino como
 * pasaria con los segmentos de un circuito.
 */
export async function moverMovimientoDeCategoria(
  eventId: string,
  id: string,
  hacia: "arriba" | "abajo",
): Promise<FormState> {
  await requireManage(eventId);
  const supabase = await createClient();

  const { data: actual } = await supabase
    .from("division_movements")
    .select("id, division_id, order_index")
    .eq("id", id)
    .maybeSingle();

  if (!actual) return { error: "Ese movimiento ya no existe." };

  const { data: vecino } = await supabase
    .from("division_movements")
    .select("id, order_index")
    .eq("division_id", actual.division_id)
    [hacia === "arriba" ? "lt" : "gt"]("order_index", actual.order_index)
    .order("order_index", { ascending: hacia !== "arriba" })
    .limit(1)
    .maybeSingle();

  // Ya esta en la punta: no es un error, no hay nada que hacer.
  if (!vecino) return OK;

  const [a, b] = await Promise.all([
    supabase
      .from("division_movements")
      .update({ order_index: vecino.order_index })
      .eq("id", actual.id),
    supabase
      .from("division_movements")
      .update({ order_index: actual.order_index })
      .eq("id", vecino.id),
  ]);

  if (a.error || b.error) return { error: "No se pudo reordenar." };

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
