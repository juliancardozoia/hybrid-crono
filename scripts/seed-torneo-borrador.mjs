/**
 * Siembra una competencia EN BORRADOR, LISTA para probar el juzgamiento en
 * vivo: 1 categoria, 10 atletas, y las 5 pruebas ya armadas (bloques,
 * movimientos y `capture_mode = 'en_vivo'`), repartidas en 3 fases.
 *
 *   node scripts/seed-torneo-borrador.mjs
 *
 * A diferencia de seed-torneo-etapas.mjs y seed-torneo-3-fases.mjs, este
 * script NO CARGA NINGUN SCORE, NO ARMA HEATS y NO CONFIRMA NINGUN CORTE DE
 * ETAPA -- eso es lo que queda para hacer a mano: distribuir heats, jugar
 * cada fase con la pantalla del juez de verdad, y confirmar en /puntuacion
 * quien avanza de una etapa a la siguiente.
 *
 * REUSA la organizacion y el usuario que ya crearon seed-torneo-3-fases.mjs
 * (liga.3fases@prueba.com / prueba1234, org "Liga 3 Fases de Prueba", plan
 * Pro) en vez de crear un tercer usuario de prueba -- `capture_mode =
 * 'en_vivo'` exige plan Pro, y esa organizacion ya lo tiene. Si esa
 * organizacion no existe todavia, corre primero `npm run seed:3fases`.
 *
 * Es idempotente PERO ACOTADO: borra solo ESTE evento por su slug, nunca la
 * organizacion entera -- "Copa 3 Fases" (la otra competencia de esa org) no se
 * toca.
 *
 *   Fase 1 — Clasificatoria: 3 WODs. Fase 2 — Semifinal: 1 WOD.
 *   Fase 3 — Final: 1 WOD. 1 categoria, 10 atletas.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ORG_SLUG = "liga-3-fases-prueba";
const EVENT_SLUG = "copa-borrador-prueba";

function morir(paso, error) {
  console.error(`\n  FALLA en ${paso}:`, error?.message ?? error);
  process.exit(1);
}

/**
 * Reintenta un `TypeError: fetch failed` -- un blip de red en medio de un
 * script que encadena varios cientos de requests, no un error de datos. Un
 * error de Postgres (constraint, permiso) NO es un `TypeError` y sigue
 * abortando de una, que es lo que corresponde.
 */
async function conReintentos(fn, intentos = 4) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof TypeError) || i === intentos) throw error;
      const espera = 500 * i;
      console.log(`   (red inestable, reintento ${i}/${intentos - 1} en ${espera}ms…)`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

async function insertar(tabla, filas, paso) {
  const { data, error } = await conReintentos(() => db.from(tabla).insert(filas).select());
  if (error) morir(paso ?? tabla, error);
  return data;
}

const { data: org, error: errorOrg } = await conReintentos(() =>
  db.from("organizations").select("id, plan").eq("slug", ORG_SLUG).maybeSingle(),
);
if (errorOrg || !org) {
  morir(
    "buscar la organización",
    errorOrg ?? `No existe "${ORG_SLUG}". Corré primero: npm run seed:3fases`,
  );
}
if (org.plan !== "pro") {
  morir("verificar el plan", `La organización "${ORG_SLUG}" no está en plan Pro (capture_mode 'en_vivo' lo exige)`);
}

// ---------------------------------------------------------------------------
// Limpieza ACOTADA A ESTE EVENTO: nunca se toca la organizacion ni el resto
// de sus competencias.
// ---------------------------------------------------------------------------

async function borrarEvento(eventId) {
  for (const tabla of [
    "timing_events",
    "results",
    "lanes",
    "heats",
    "arenas",
    "workout_scores",
    "stage_advancements",
    "scoring_snapshots",
    "division_movement_specs",
    "division_movements",
    "part_movements",
    "part_blocks",
    "part_divisions",
    "workout_parts",
    "workouts",
    "registration_members",
    "registrations",
    "division_registration",
    "orders",
    "team_members",
    "teams",
    "athletes",
    "divisions",
    "segments",
    "course_templates",
    "penalty_types",
  ]) {
    const { error } = await conReintentos(() => db.from(tabla).delete().eq("event_id", eventId));
    if (error) morir(`borrar ${tabla}`, error);
  }
  const { error } = await conReintentos(() => db.from("events").delete().eq("id", eventId));
  if (error) morir("borrar el evento", error);
}

const { data: previo } = await conReintentos(() =>
  db.from("events").select("id").eq("public_slug", EVENT_SLUG).maybeSingle(),
);
if (previo) {
  console.log("Borrando la siembra anterior de este evento…");
  await borrarEvento(previo.id);
}

/** Busca un movimiento del catalogo por nombre exacto. */
async function movimiento(nombre) {
  const { data, error } = await conReintentos(() =>
    db.from("movements").select("id").eq("name", nombre).maybeSingle(),
  );
  if (error || !data) morir(`buscar el movimiento "${nombre}"`, error ?? "no está en el catálogo");
  return data.id;
}

/** Una prueba de una sola parte, EN VIVO, con su bloque, sus movimientos y su categoria asignada. */
async function crearPrueba(eventId, divisiones, { nombre, stage, orden, parte, bloque, movimientos }) {
  const [w] = await insertar("workouts", {
    event_id: eventId,
    order_index: orden,
    stage,
    name: nombre,
  });
  const [p] = await insertar("workout_parts", {
    workout_id: w.id,
    event_id: eventId,
    order_index: 0,
    capture_mode: "en_vivo",
    ...parte,
  });
  await insertar(
    "part_divisions",
    divisiones.map((d) => ({ part_id: p.id, division_id: d.id, event_id: eventId })),
  );

  const [b] = await insertar("part_blocks", {
    part_id: p.id,
    event_id: eventId,
    order_index: 0,
    kind: "trabajo",
    ...bloque,
  });
  for (const [i, m] of movimientos.entries()) {
    await insertar("part_movements", {
      block_id: b.id,
      part_id: p.id,
      event_id: eventId,
      order_index: i,
      movement_id: await movimiento(m.nombre),
      unit: m.unidad ?? "reps",
      target_per_round: m.objetivo,
      load_kg: m.kg ?? null,
      max_reps: m.maxReps ?? false,
    });
  }
  return w.id;
}

// ---------------------------------------------------------------------------
// El evento, las categorias, los atletas.
// ---------------------------------------------------------------------------

console.log("Creando el evento (borrador)…");
const [evento] = await insertar("events", {
  org_id: org.id,
  name: "Copa Borrador de Prueba",
  public_slug: EVENT_SLUG,
  venue: "Arena Central",
  status: "draft",
  format: "crossfit",
  organizer_name: "Liga 3 Fases de Prueba",
  country: "CO",
  city: "Bogotá",
  starts_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
  shirt_sizes: ["S", "M", "L"],
});

const CATEGORIAS = [{ name: "Rx Masculino", gender_rule: "male", cupo: 10 }];

const divisiones = await insertar(
  "divisions",
  CATEGORIAS.map((c) => ({
    event_id: evento.id,
    name: c.name,
    team_size: 1,
    gender_rule: c.gender_rule,
    course_template_id: null,
  })),
);

const NOMBRES_H = ["Andrés", "Camilo", "Daniel", "Esteban", "Felipe", "Gabriel", "Héctor", "Iván", "Jorge", "Kevin"];
const APELLIDOS = ["Álvarez", "Bermúdez", "Castaño", "Duarte", "Escobar", "Franco", "Gómez", "Herrera", "Ibáñez", "Jaramillo"];

console.log("Creando 10 atletas en 1 categoría…");
let dorsal = 101;
for (const [i, division] of divisiones.entries()) {
  const cupo = CATEGORIAS[i].cupo;
  for (let j = 0; j < cupo; j += 1) {
    const [atleta] = await insertar("athletes", {
      event_id: evento.id,
      first_name: NOMBRES_H[dorsal % NOMBRES_H.length],
      last_name: APELLIDOS[(dorsal * 3) % APELLIDOS.length],
      gender: "male",
    });
    const [equipo] = await insertar("teams", {
      event_id: evento.id,
      division_id: division.id,
      bib_number: dorsal,
    });
    await insertar("team_members", { team_id: equipo.id, athlete_id: atleta.id, event_id: evento.id });
    dorsal += 1;
  }
}

// ---------------------------------------------------------------------------
// Las 5 pruebas: Fase 1 (3 WODs), Fase 2 (semifinal), Fase 3 (final). Todas
// 'en vivo', con bloques y movimientos reales, y ya asignadas a la unica
// categoria del evento -- listas para largar un heat y jugarlas con la
// pantalla del juez de verdad. SIN scores, SIN heats, SIN cortes
// confirmados: eso lo hace el organizador a mano.
// ---------------------------------------------------------------------------

console.log("Creando las 5 pruebas (todas 'en vivo')…");

await crearPrueba(evento.id, divisiones, {
  nombre: "Fase 1 · WOD 1 — Fran",
  stage: 1,
  orden: 0,
  parte: { time_scheme: "cap", score_unit: "tiempo", score_dir: "menor_gana", time_cap_ms: 600_000, cap_unit: "reps" },
  bloque: { repeticiones: 3 },
  movimientos: [
    { nombre: "Thruster", objetivo: [21, 15, 9], kg: 43 },
    { nombre: "Pull-up", objetivo: [21, 15, 9] },
  ],
});

await crearPrueba(evento.id, divisiones, {
  nombre: "Fase 1 · WOD 2 — Cindy",
  stage: 1,
  orden: 1,
  parte: { time_scheme: "ventana", score_unit: "rondas_reps", score_dir: "mayor_gana", window_ms: 1_200_000 },
  // Un AMRAP no tiene "cuantas rondas": se repiten los mismos movimientos
  // hasta que se acaba la ventana (misma doctrina que RONDAS_AMRAP_SIN_LIMITE
  // en features/workouts/actions.ts). Con `repeticiones: 1` el plan del juez
  // solo tenia UNA ronda: la pantalla se bloqueaba como "completo" apenas se
  // cerraba pull-up/push-up/air-squat la primera vez, a los ~3 minutos de un
  // AMRAP de 20 -- y los diez atletas quedaban empatados en "1 ronda, 0 reps"
  // sin haber tenido chance de marcar mas.
  bloque: { repeticiones: 50 },
  movimientos: [
    { nombre: "Pull-up", objetivo: [5] },
    { nombre: "Push-up", objetivo: [10] },
    { nombre: "Air Squat", objetivo: [15] },
  ],
});

await crearPrueba(evento.id, divisiones, {
  nombre: "Fase 1 · WOD 3 — Deadlift máximo",
  stage: 1,
  orden: 2,
  parte: { time_scheme: "sin_reloj", score_unit: "carga", score_dir: "mayor_gana" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Deadlift", objetivo: [1] }],
});

await crearPrueba(evento.id, divisiones, {
  nombre: "Fase 2 — Semifinal: Grace",
  stage: 2,
  orden: 3,
  parte: { time_scheme: "cap", score_unit: "tiempo", score_dir: "menor_gana", time_cap_ms: 480_000, cap_unit: "reps" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Clean and Jerk", objetivo: [30], kg: 61 }],
});

await crearPrueba(evento.id, divisiones, {
  nombre: "Fase 3 — Final: Snatch máximo",
  stage: 3,
  orden: 4,
  parte: { time_scheme: "sin_reloj", score_unit: "carga", score_dir: "mayor_gana" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Snatch", objetivo: [1] }],
});

console.log(`
Listo. Quedó en BORRADOR, a propósito: falta todo lo que vas a ir haciendo vos.

  Entrá como liga.3fases@prueba.com / prueba1234 → Panel → "Copa Borrador de
  Prueba".

  Lo que ya está armado:

    1 categoría (Rx Masculino ×10 atletas), y las 5 pruebas — todas 'en
    vivo', con sus bloques y movimientos reales, ya asignadas a la
    categoría — repartidas en 3 fases:

      Fase 1 — Clasificatoria: Fran, Cindy, Deadlift máximo (las 3 corren
                                todos los atletas de la fase).
      Fase 2 — Semifinal: Grace.
      Fase 3 — Final: Snatch máximo.

  Lo que falta, A PROPÓSITO, para que lo ensayes vos:

    1. "Marcar como lista" en Resumen, cuando termines de revisar.
    2. Invitar jueces (o asignarte vos mismo) desde /jueces.
    3. Distribuir los heats de la Fase 1 (Heats → "Distribuir
       automáticamente", elegí el WOD y cuántos carriles por heat).
    4. Largar los heats y jugarlos con la pantalla del juez de verdad.
    5. Cuando la Fase 1 termine, confirmar en /puntuacion quién avanza a la
       Semifinal (Fase 2) — ahí vas a poder ver en vivo el mismo caso que
       armamos con la siembra anterior: el corte resetea el campo, así que
       ganar la clasificatoria no arrastra puntos a la semifinal ni a la
       final.
    6. Repetir el paso 3-5 para la Semifinal y la Final.
`);
