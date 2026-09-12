/**
 * Siembra una competencia de CrossFit EN BORRADOR, con 2 categorías (Rx
 * Masculino y Rx Femenino, 10 atletas cada una) y 2 pruebas, las dos
 * `capture_mode = 'en_vivo'` -- listas para jugarlas con la pantalla del
 * juez de verdad apenas se distribuyan heats:
 *
 *   WOD 1 — For Time, 3 bloques:
 *     Bloque 1: 30 Clean and Jerk
 *     Bloque 2: 60 seg de descanso
 *     Bloque 3: 15-12-9 Thruster + Burpee
 *
 *   WOD 2 — AMRAP para reps (12 min): Pull-up, Push-up, Air Squat
 *
 *   node scripts/seed-crossfit-2wods.mjs
 *
 * Autocontenido: crea su propia organización (plan Pro, porque
 * `capture_mode = 'en_vivo'` lo exige) y su propio usuario organizador, sin
 * depender de ningún otro script de siembra. Es idempotente: borra su propia
 * organización si ya existía y la vuelve a crear entera.
 *
 * Queda en BORRADOR a propósito -- lo que falta para jugarlo (marcar como
 * listo, invitar jueces, distribuir heats, largar) lo hace el organizador a
 * mano, igual que seed-torneo-borrador.mjs.
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

const CLAVE = "prueba1234";
const ORGANIZADOR_EMAIL = "crossfit2wods@prueba.com";
const ORG_SLUG = "crossfit-2-wods-prueba";
const EVENT_SLUG = "crossfit-2-wods-prueba";

function morir(paso, error) {
  console.error(`\n  FALLA en ${paso}:`, error?.message ?? error);
  process.exit(1);
}

/**
 * Reintenta un `TypeError: fetch failed` -- un blip de red en medio de un
 * script que encadena varios cientos de requests, no un error de datos.
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

// ---------------------------------------------------------------------------
// Limpieza: si esta organización ya existía de una corrida anterior, se
// borra entera (eventos y usuario incluidos) antes de volver a crearla.
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
    "event_staff",
  ]) {
    const { error } = await conReintentos(() => db.from(tabla).delete().eq("event_id", eventId));
    if (error) morir(`borrar ${tabla}`, error);
  }
  const { error } = await conReintentos(() => db.from("events").delete().eq("id", eventId));
  if (error) morir("borrar el evento", error);
}

async function borrarOrganizacion(orgId) {
  const { data: eventos } = await conReintentos(() =>
    db.from("events").select("id").eq("org_id", orgId),
  );
  for (const e of eventos ?? []) await borrarEvento(e.id);
  const { error } = await conReintentos(() => db.from("organizations").delete().eq("id", orgId));
  if (error) morir("borrar la organización", error);
}

const { data: previa } = await conReintentos(() =>
  db.from("organizations").select("id").eq("slug", ORG_SLUG).maybeSingle(),
);
if (previa) {
  console.log("Borrando la siembra anterior…");
  await borrarOrganizacion(previa.id);
  const { data: lista } = await db.auth.admin.listUsers({ perPage: 1000 });
  const previo = lista?.users.find((u) => u.email === ORGANIZADOR_EMAIL);
  if (previo) await db.auth.admin.deleteUser(previo.id);
}

console.log("Creando el usuario organizador…");
const { data: usuario, error: errorUsuario } = await db.auth.admin.createUser({
  email: ORGANIZADOR_EMAIL,
  password: CLAVE,
  email_confirm: true,
  user_metadata: { full_name: "Organizador CrossFit 2 WODs" },
});
if (errorUsuario) morir("crear el usuario", errorUsuario);

console.log("Creando la organización (plan Pro)…");
const [org] = await insertar("organizations", {
  name: "CrossFit 2 WODs de Prueba",
  slug: ORG_SLUG,
  created_by: usuario.user.id,
});
const { error: errorPlan } = await db.from("organizations").update({ plan: "pro" }).eq("id", org.id);
if (errorPlan) morir("poner el plan Pro", errorPlan);

/** Busca un movimiento del catálogo por nombre exacto. */
async function movimiento(nombre) {
  const { data, error } = await conReintentos(() =>
    db.from("movements").select("id").eq("name", nombre).maybeSingle(),
  );
  if (error || !data) morir(`buscar el movimiento "${nombre}"`, error ?? "no está en el catálogo");
  return data.id;
}

/**
 * Una prueba (workout) de UNA parte, `en_vivo`, con N bloques y sus
 * movimientos, ya asignada a las categorías que reciba.
 */
async function crearPrueba(eventId, divisiones, { nombre, orden, parte, bloques }) {
  const [w] = await insertar("workouts", { event_id: eventId, order_index: orden, name: nombre });
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

  for (const [bi, bloque] of bloques.entries()) {
    const { movimientos, ...campos } = bloque;
    const [b] = await insertar("part_blocks", {
      part_id: p.id,
      event_id: eventId,
      order_index: bi,
      ...campos,
    });
    for (const [i, m] of (movimientos ?? []).entries()) {
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
  }
  return w.id;
}

// ---------------------------------------------------------------------------
// El evento, las categorías, los atletas.
// ---------------------------------------------------------------------------

console.log("Creando el evento (borrador)…");
const [evento] = await insertar("events", {
  org_id: org.id,
  name: "CrossFit 2 WODs de Prueba",
  public_slug: EVENT_SLUG,
  venue: "Box Central",
  status: "draft",
  format: "crossfit",
  organizer_name: "CrossFit 2 WODs de Prueba",
  country: "CO",
  city: "Bogotá",
  starts_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  shirt_sizes: ["S", "M", "L"],
});

const CATEGORIAS = [
  { name: "Rx Masculino", gender_rule: "male", genero: "male", cupo: 10 },
  { name: "Rx Femenino", gender_rule: "female", genero: "female", cupo: 10 },
];

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

const NOMBRES_M = ["Andrés", "Camilo", "Daniel", "Esteban", "Felipe", "Gabriel", "Héctor", "Iván", "Jorge", "Kevin"];
const NOMBRES_F = ["Ana", "Camila", "Daniela", "Estefanía", "Fernanda", "Gabriela", "Isabela", "Juliana", "Karina", "Laura"];
const APELLIDOS = ["Álvarez", "Bermúdez", "Castaño", "Duarte", "Escobar", "Franco", "Gómez", "Herrera", "Ibáñez", "Jaramillo"];

console.log("Creando 10 atletas por categoría (20 en total)…");
let dorsal = 101;
for (const [i, division] of divisiones.entries()) {
  const { cupo, genero } = CATEGORIAS[i];
  const nombres = genero === "male" ? NOMBRES_M : NOMBRES_F;
  for (let j = 0; j < cupo; j += 1) {
    const [atleta] = await insertar("athletes", {
      event_id: evento.id,
      first_name: nombres[j],
      last_name: APELLIDOS[j],
      gender: genero,
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
// Las 2 pruebas, las dos 'en vivo' y asignadas a las 2 categorías.
// ---------------------------------------------------------------------------

console.log("Creando las 2 pruebas ('en vivo')…");

await crearPrueba(evento.id, divisiones, {
  nombre: "WOD 1 — For Time",
  orden: 0,
  parte: {
    time_scheme: "cap",
    score_unit: "tiempo",
    score_dir: "menor_gana",
    time_cap_ms: 1_200_000, // 20 min
    cap_unit: "reps",
  },
  bloques: [
    {
      kind: "trabajo",
      repeticiones: 1,
      movimientos: [{ nombre: "Clean and Jerk", objetivo: [30], kg: 61 }],
    },
    {
      kind: "descanso",
      repeticiones: 1,
      duracion_ms: 60_000,
    },
    {
      kind: "trabajo",
      repeticiones: 3,
      movimientos: [
        { nombre: "Thruster", objetivo: [15, 12, 9], kg: 43 },
        { nombre: "Burpee", objetivo: [15, 12, 9] },
      ],
    },
  ],
});

await crearPrueba(evento.id, divisiones, {
  nombre: "WOD 2 — AMRAP",
  orden: 1,
  parte: {
    time_scheme: "ventana",
    score_unit: "rondas_reps",
    score_dir: "mayor_gana",
    window_ms: 720_000, // 12 min
  },
  bloques: [
    {
      kind: "trabajo",
      // Un AMRAP no tiene "cuantas rondas": se repiten los mismos
      // movimientos hasta que se acaba la ventana (misma doctrina que
      // RONDAS_AMRAP_SIN_LIMITE en features/workouts/actions.ts).
      repeticiones: 50,
      movimientos: [
        { nombre: "Pull-up", objetivo: [5] },
        { nombre: "Push-up", objetivo: [10] },
        { nombre: "Air Squat", objetivo: [15] },
      ],
    },
  ],
});

console.log(`
Listo. Quedó en BORRADOR, a propósito: falta todo lo que vas a ir haciendo vos.

  Entrá como ${ORGANIZADOR_EMAIL} / ${CLAVE} → Panel → "CrossFit 2 WODs de
  Prueba".

  Lo que ya está armado:

    2 categorías (Rx Masculino y Rx Femenino, ×10 atletas cada una) y 2
    pruebas — las dos 'en vivo', ya asignadas a las 2 categorías:

      WOD 1 — For Time (cap 20 min): 30 Clean and Jerk (61 kg) → 60 seg de
              descanso → 15-12-9 Thruster (43 kg) + Burpee.
      WOD 2 — AMRAP 12 min para reps: 5 Pull-up / 10 Push-up / 15 Air Squat.

  Lo que falta, A PROPÓSITO, para que lo ensayes vos:

    1. "Marcar como lista" en Resumen, cuando termines de revisar.
    2. Invitar jueces (o asignarte vos mismo) desde /jueces.
    3. Distribuir los heats de cada WOD (Heats → "Distribuir automáticamente",
       elegí el WOD y cuántos carriles por heat).
    4. Largar los heats y jugarlos con la pantalla del juez de verdad.
`);
