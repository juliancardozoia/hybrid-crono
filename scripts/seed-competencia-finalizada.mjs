/**
 * Siembra una competencia de CrossFit YA FINALIZADA, con seis categorías, tres
 * etapas con cortes y podio calculado para cada una:
 *
 *   node scripts/seed-competencia-finalizada.mjs
 *
 * Categorías (las seis corren las MISMAS pruebas — `part_divisions` liga cada
 * parte a las seis):
 *
 *   Principiante Femenino / Masculino
 *   Intermedio Femenino / Masculino
 *   Rx Femenino / Masculino
 *
 * Cada categoría arranca con 12 atletas (>= 10), con bandera (`athletes.country`,
 * ISO-2) y box (`athletes.box`) random.
 *
 * Tres etapas, cortando el field en cada una — mismo mecanismo que
 * `seed-torneo-3-fases.mjs` (`stage_advancements` + `scoring_snapshots`
 * congelado), pero acá las SEIS categorías lo corren en paralelo:
 *
 *   Etapa 1 — 4 WODs, corren los 12.            Corte: avanzan los 8 mejores.
 *   Etapa 2 — 2 WODs, corren los 8 que avanzaron. Corte: avanzan los 4 mejores.
 *   Etapa 3 — 1 WOD,  corren los 4 finalistas.    Define el podio.
 *
 * `events.status = 'published'` y los tres snapshots quedan `locked_at`
 * (excepto la etapa 1, que no es un corte — ver corte_por_puesto_auditado.sql:
 * "cut_position ... solo tiene sentido desde la etapa 2"): la competencia se
 * lee como TERMINADA, con podio en la tabla de la etapa 3 de cada categoría.
 *
 * Cada WOD tiene su propio heat por categoría (`heats` + `lanes`), con SOLO
 * los equipos que corrieron esa etapa — 12 en la etapa 1, los 8 que avanzaron
 * en la etapa 2, los 4 finalistas en la etapa 3 —, ya `status: 'finished'`
 * con `started_at`/`ended_at`: no quedan heats "fantasma" sin correr, y el
 * corte de cada etapa se ve también en quién tiene carril en cada WOD.
 *
 * Los puntajes son aleatorios (sin semilla): cada corrida arma un campo y un
 * podio distintos, a propósito — mismo criterio que `seed-torneo-etapas.mjs`.
 *
 * Borra su propia siembra anterior antes de crear (busca la organización por
 * slug), igual que el resto de los scripts de este directorio.
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
const OWNER_EMAIL = "liga.finalizada@prueba.com";
const ORG_SLUG = "liga-competencia-finalizada-prueba";

function morir(paso, error) {
  console.error(`\n  FALLA en ${paso}:`, error?.message ?? error);
  process.exit(1);
}

async function insertar(tabla, filas, paso) {
  const { data, error } = await db.from(tabla).insert(filas).select();
  if (error) morir(paso ?? tabla, error);
  return data;
}

// ---------------------------------------------------------------------------
// Limpieza — mismo patrón que seed-torneo-3-fases.mjs. `scoring_snapshots` y
// `stage_advancements` cuelgan de `divisions` con on delete cascade.
// ---------------------------------------------------------------------------

async function borrarOrganizacion(orgId) {
  const { data: eventos } = await db.from("events").select("id").eq("org_id", orgId);
  for (const { id } of eventos ?? []) {
    for (const tabla of [
      "timing_events",
      "results",
      "lanes",
      "heats",
      "arenas",
      "workout_scores",
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
      const { error } = await db.from(tabla).delete().eq("event_id", id);
      if (error) morir(`borrar ${tabla}`, error);
    }
    const { error } = await db.from("events").delete().eq("id", id);
    if (error) morir("borrar el evento", error);
  }
  const { error } = await db.from("organizations").delete().eq("id", orgId);
  if (error) morir("borrar la organización", error);
}

const { data: previa } = await db.from("organizations").select("id").eq("slug", ORG_SLUG);
if (previa?.length) {
  console.log("Borrando la siembra anterior…");
  for (const { id } of previa) await borrarOrganizacion(id);
  const { data: lista } = await db.auth.admin.listUsers({ perPage: 1000 });
  const previo = lista?.users?.find((u) => u.email === OWNER_EMAIL);
  if (previo) await db.auth.admin.deleteUser(previo.id);
}

console.log("Creando organización…");
const { data: owner, error: errorOwner } = await db.auth.admin.createUser({
  email: OWNER_EMAIL,
  password: CLAVE,
  email_confirm: true,
  user_metadata: { full_name: "Dueña de Liga Finalizada" },
});
if (errorOwner) morir("crear el dueño", errorOwner);

const [org] = await insertar("organizations", {
  name: "Liga Competencia Finalizada",
  slug: ORG_SLUG,
  created_by: owner.user.id,
});
{
  const { error } = await db.from("organizations").update({ plan: "pro" }).eq("id", org.id);
  if (error) morir("activar el plan pro", error);
}

// ---------------------------------------------------------------------------
// La curva de puntos (Games 2026), igual que en los otros seeds de etapas.
// ---------------------------------------------------------------------------

const GAMES_2026 = [
  100, 96, 92, 88, 84, 80, 76, 72, 68, 64,
  60, 56, 52, 48, 45, 42, 39, 36, 33, 30,
  27, 24, 21, 18, 15, 12, 9, 6, 3, 0,
];

function puntosDinamicos(fieldSize) {
  const n = Math.max(1, Math.floor(fieldSize));
  if (n === 1) return [GAMES_2026[0]];
  return Array.from({ length: n }, (_, i) => {
    const posicion = i + 1;
    const equivalente = 1 + ((posicion - 1) * (GAMES_2026.length - 1)) / (n - 1);
    const bajo = Math.floor(equivalente);
    const alto = Math.ceil(equivalente);
    const valorBajo = GAMES_2026[bajo - 1];
    if (bajo === alto) return Math.round(valorBajo * 1000) / 1000;
    const valorAlto = GAMES_2026[alto - 1];
    const fraccion = equivalente - bajo;
    return Math.round((valorBajo + fraccion * (valorAlto - valorBajo)) * 1000) / 1000;
  });
}

/** Ordena por valor segun la direccion de la prueba y devuelve la posicion de cada uno. */
function posicionesPorValor(entradas, dir) {
  const orden = [...entradas].sort((a, b) => (dir === "mayor_gana" ? b.valor - a.valor : a.valor - b.valor));
  return orden.map((e, i) => ({ ...e, posicion: i + 1 }));
}

function aleatorioEntre(min, max) {
  return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------------------
// Nombres, países y boxes.
// ---------------------------------------------------------------------------

const NOMBRES_H = ["Andrés", "Camilo", "Daniel", "Esteban", "Felipe", "Gabriel", "Héctor", "Iván", "Jorge", "Kevin", "Luis", "Marcos", "Nicolás", "Óscar", "Pablo", "Rodrigo", "Samuel", "Tomás", "Adrián", "Bruno"];
const NOMBRES_M = ["Ana", "Beatriz", "Camila", "Daniela", "Elena", "Fernanda", "Gabriela", "Helena", "Isabel", "Juliana", "Karen", "Laura", "María", "Natalia", "Olga", "Paola", "Renata", "Sofía", "Valentina", "Ximena"];
const APELLIDOS = ["Álvarez", "Bermúdez", "Castaño", "Duarte", "Escobar", "Franco", "Gómez", "Herrera", "Ibáñez", "Jaramillo", "Klein", "Lozano", "Molina", "Naranjo", "Ospina", "Peña", "Quintero", "Rueda", "Salazar", "Torres"];
const PAISES = ["CO", "MX", "PE", "CL", "AR", "EC", "BR", "US", "ES", "PA", "CR", "UY"];
const BOXES = ["CrossFit Titán", "Box Fénix", "CrossFit Andina", "Iron Tribe Box", "CrossFit Cóndor", "Box Alfa", "CrossFit Nova", "Box Guerrero", "CrossFit Kaizen", "Box Spartan", "CrossFit Cima", "Box Vikingo", "CrossFit Aurora", "Box Halcón", "CrossFit Estirpe"];

function elegir(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

/** Busca un movimiento del catálogo por nombre exacto. */
async function movimiento(nombre) {
  const { data, error } = await db.from("movements").select("id").eq("name", nombre).maybeSingle();
  if (error || !data) morir(`buscar el movimiento "${nombre}"`, error ?? "no está en el catálogo");
  return data.id;
}
const idMovimiento = new Map();
async function idDe(nombre) {
  if (!idMovimiento.has(nombre)) idMovimiento.set(nombre, await movimiento(nombre));
  return idMovimiento.get(nombre);
}

/** Una prueba de una sola parte, ligada a VARIAS categorías a la vez. */
async function crearPrueba(eventId, divisionIds, { nombre, stage, orden, parte, bloque, movimientos }) {
  const [w] = await insertar("workouts", {
    event_id: eventId,
    order_index: orden,
    stage,
    name: nombre,
    released_at: new Date(Date.now() - 86_400_000).toISOString(),
  });
  const [p] = await insertar("workout_parts", {
    workout_id: w.id,
    event_id: eventId,
    order_index: 0,
    capture_mode: "manual",
    ...parte,
  });
  await insertar(
    "part_divisions",
    divisionIds.map((division_id) => ({ part_id: p.id, division_id, event_id: eventId })),
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
      movement_id: await idDe(m.nombre),
      unit: m.unidad ?? "reps",
      target_per_round: m.objetivo,
      load_kg: m.kg ?? null,
      max_reps: m.maxReps ?? false,
    });
  }
  return { workoutId: w.id, partId: p.id, scoreUnit: parte.score_unit, dir: parte.score_dir };
}

// Contador global de "franjas horarias": cada WOD ocupa la suya, para que los
// heats de las seis categorías queden ordenados cronologicamente.
let franjaHoraria = 0;
const INICIO_COMPETENCIA = new Date(Date.now() - 3 * 86_400_000);

/** Un heat YA CORRIDO para (workout, division), con un carril por equipo. */
async function crearHeatFinalizado(eventId, divisionId, workoutId, equipos) {
  const inicio = new Date(INICIO_COMPETENCIA.getTime() + franjaHoraria * 40 * 60_000);
  const fin = new Date(inicio.getTime() + 20 * 60_000);
  franjaHoraria += 1;

  const [heat] = await insertar("heats", {
    event_id: eventId,
    division_id: divisionId,
    workout_id: workoutId,
    name: "Heat 1",
    lane_count: equipos.length,
    status: "finished",
    scheduled_at: inicio.toISOString(),
    scheduled_end_at: fin.toISOString(),
    started_at: inicio.toISOString(),
    ended_at: fin.toISOString(),
    start_source: "server",
  });

  await insertar(
    "lanes",
    equipos.map((e, i) => ({
      heat_id: heat.id,
      event_id: eventId,
      lane_number: i + 1,
      team_id: e.teamId,
      status: "finished",
    })),
  );
}

/** Carga un score manual directo en `workout_scores`. */
async function cargarScore(partId, teamId, { status, value = null, reps = null, capValue = null }) {
  const { error } = await db.from("workout_scores").insert({
    part_id: partId,
    team_id: teamId,
    status,
    value_num: value,
    value_reps: reps,
    value_cap: capValue,
    source: "manual",
  });
  if (error) morir(`cargar score de ${teamId} en ${partId}`, error);
}

/** Genera un valor de score plausible para una prueba, a partir del nivel del atleta. */
function generarMarca(scoreUnit, dir, nivel, tunning) {
  if (scoreUnit === "tiempo") {
    const { base, spread, ruido } = tunning;
    return { valor: Math.max(120_000, Math.round(base - nivel * spread - aleatorioEntre(0, ruido))) };
  }
  if (scoreUnit === "rondas_reps") {
    const { rondasBase, rondasSpread, repsMax } = tunning;
    const rondas = Math.max(1, Math.floor(rondasBase + nivel * rondasSpread + aleatorioEntre(-1, 1)));
    const reps = Math.floor(aleatorioEntre(0, repsMax));
    return { valor: rondas * 1000 + reps, rondas, reps };
  }
  if (scoreUnit === "carga") {
    const { base, spread, ruido } = tunning;
    return { valor: Math.round((base + nivel * spread + aleatorioEntre(-ruido, ruido)) * 10) / 10 };
  }
  throw new Error(`unidad de score no manejada en el seed: ${scoreUnit}`);
}

/** Congela el corte de una etapa: quien avanza + el standing completo (simplificado). */
async function confirmarCorte(eventId, divisionId, stage, avanzanIds, todosLosIds) {
  await insertar(
    "stage_advancements",
    avanzanIds.map((teamId) => ({ event_id: eventId, division_id: divisionId, stage, team_id: teamId })),
    "stage_advancements",
  );
  await insertar(
    "scoring_snapshots",
    [
      {
        event_id: eventId,
        division_id: divisionId,
        stage,
        field_size: avanzanIds.length,
        points: puntosDinamicos(avanzanIds.length),
        cut_position: avanzanIds.length,
        cut_standings: todosLosIds.map((t, i) => ({
          team_id: t.teamId,
          rank: i + 1,
          points: t.puntos,
          tied_with: 1,
          advanced: avanzanIds.includes(t.teamId),
        })),
        cut_standings_hash: `seed-${divisionId}-${stage}`,
        locked_at: new Date().toISOString(),
      },
    ],
    "scoring_snapshots",
  );
}

// ---------------------------------------------------------------------------
// El evento y las seis categorías.
// ---------------------------------------------------------------------------

const CUPO_ETAPA1 = 12;
const CUPO_ETAPA2 = 8;
const CUPO_ETAPA3 = 4;

console.log("Creando el evento…");
const [evento] = await insertar("events", {
  org_id: org.id,
  name: "Copa Finalizada — Seis Categorías",
  public_slug: "copa-finalizada-seis-categorias",
  venue: "Arena Central",
  status: "published",
  format: "crossfit",
  organizer_name: "Liga Competencia Finalizada",
  country: "CO",
  city: "Bogotá",
  starts_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  shirt_sizes: ["S", "M", "L", "XL"],
});

const CATEGORIAS = [
  { name: "Principiante Femenino", gender_rule: "female" },
  { name: "Principiante Masculino", gender_rule: "male" },
  { name: "Intermedio Femenino", gender_rule: "female" },
  { name: "Intermedio Masculino", gender_rule: "male" },
  { name: "Rx Femenino", gender_rule: "female" },
  { name: "Rx Masculino", gender_rule: "male" },
];

console.log("Creando categorías y atletas…");
let dorsal = 1;
const divisiones = [];
for (const c of CATEGORIAS) {
  const [division] = await insertar("divisions", {
    event_id: evento.id,
    name: c.name,
    team_size: 1,
    gender_rule: c.gender_rule,
    course_template_id: null,
  });

  const pila = c.gender_rule === "female" ? NOMBRES_M : NOMBRES_H;
  const equipos = [];
  for (let i = 0; i < CUPO_ETAPA1; i += 1) {
    const [atleta] = await insertar("athletes", {
      event_id: evento.id,
      first_name: pila[(dorsal + i) % pila.length],
      last_name: APELLIDOS[(dorsal * 3 + i) % APELLIDOS.length],
      gender: c.gender_rule,
      country: elegir(PAISES),
      box: elegir(BOXES),
    });
    const [equipo] = await insertar("teams", {
      event_id: evento.id,
      division_id: division.id,
      bib_number: dorsal,
    });
    await insertar("team_members", { team_id: equipo.id, athlete_id: atleta.id, event_id: evento.id });
    equipos.push({
      teamId: equipo.id,
      nombre: `${atleta.first_name} ${atleta.last_name}`,
      bib: dorsal,
      // Nivel 0..1: influye sus marcas de etapa 1 de forma consistente entre
      // los 4 WODs, para que el campo se lea coherente y no como puro ruido.
      nivel: Math.random(),
    });
    dorsal += 1;
  }

  divisiones.push({ ...c, id: division.id, equipos });
}

const idsDivisiones = divisiones.map((d) => d.id);

// ---------------------------------------------------------------------------
// ETAPA 1 — 4 WODs, corren las seis categorías completas.
// ---------------------------------------------------------------------------

console.log("Etapa 1 — 4 WODs (corren los 12 de cada categoría)…");

const wod1 = await crearPrueba(evento.id, idsDivisiones, {
  nombre: "Etapa 1 · WOD 1 — Fran",
  stage: 1,
  orden: 0,
  parte: { time_scheme: "cap", score_unit: "tiempo", score_dir: "menor_gana", time_cap_ms: 720_000, cap_unit: "reps" },
  bloque: { repeticiones: 3 },
  movimientos: [
    { nombre: "Thruster", objetivo: [21, 15, 9], kg: 30 },
    { nombre: "Pull-up", objetivo: [21, 15, 9] },
  ],
});

const wod2 = await crearPrueba(evento.id, idsDivisiones, {
  nombre: "Etapa 1 · WOD 2 — AMRAP 12",
  stage: 1,
  orden: 1,
  parte: { time_scheme: "ventana", score_unit: "rondas_reps", score_dir: "mayor_gana", window_ms: 720_000 },
  bloque: { repeticiones: 1 },
  movimientos: [
    { nombre: "Pull-up", objetivo: [5] },
    { nombre: "Push-up", objetivo: [10] },
    { nombre: "Air Squat", objetivo: [15] },
  ],
});

const wod3 = await crearPrueba(evento.id, idsDivisiones, {
  nombre: "Etapa 1 · WOD 3 — Deadlift máximo",
  stage: 1,
  orden: 2,
  parte: { time_scheme: "sin_reloj", score_unit: "carga", score_dir: "mayor_gana" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Deadlift", objetivo: [1] }],
});

const wod4 = await crearPrueba(evento.id, idsDivisiones, {
  nombre: "Etapa 1 · WOD 4 — Chipper",
  stage: 1,
  orden: 3,
  parte: { time_scheme: "cap", score_unit: "tiempo", score_dir: "menor_gana", time_cap_ms: 900_000, cap_unit: "reps" },
  bloque: { repeticiones: 1 },
  movimientos: [
    { nombre: "Box Jump", objetivo: [20] },
    { nombre: "Kettlebell Swing", objetivo: [20] },
    { nombre: "Burpee", objetivo: [20] },
  ],
});

const puntosEtapa1PorDivision = new Map();

for (const d of divisiones) {
  const tabla = puntosDinamicos(CUPO_ETAPA1);
  const puntos = new Map(d.equipos.map((e) => [e.teamId, 0]));

  for (const wod of [wod1, wod2, wod3, wod4]) {
    await crearHeatFinalizado(evento.id, d.id, wod.workoutId, d.equipos);
  }

  for (const [wod, tunning] of [
    [wod1, { base: 700_000, spread: 350_000, ruido: 45_000 }],
    [wod3, { base: 120, spread: 90, ruido: 8 }],
    [wod4, { base: 850_000, spread: 400_000, ruido: 50_000 }],
  ]) {
    const marcas = [];
    for (const e of d.equipos) {
      const { valor } = generarMarca(wod.scoreUnit, wod.dir, e.nivel, tunning);
      await cargarScore(wod.partId, e.teamId, { status: "valido", value: valor });
      marcas.push({ teamId: e.teamId, valor });
    }
    for (const { teamId, posicion } of posicionesPorValor(marcas, wod.dir)) {
      puntos.set(teamId, puntos.get(teamId) + tabla[posicion - 1]);
    }
  }

  // WOD 2 (rondas+reps) va aparte porque ademas de "value" carga "reps".
  {
    const marcas = [];
    for (const e of d.equipos) {
      const { valor, rondas, reps } = generarMarca(wod2.scoreUnit, wod2.dir, e.nivel, {
        rondasBase: 5,
        rondasSpread: 9,
        repsMax: 20,
      });
      await cargarScore(wod2.partId, e.teamId, { status: "valido", value: rondas, reps });
      marcas.push({ teamId: e.teamId, valor });
    }
    for (const { teamId, posicion } of posicionesPorValor(marcas, wod2.dir)) {
      puntos.set(teamId, puntos.get(teamId) + tabla[posicion - 1]);
    }
  }

  puntosEtapa1PorDivision.set(d.id, puntos);
}

// Corte hacia etapa 2: avanzan los CUPO_ETAPA2 mejores de cada categoría.
const finalistasEtapa2 = new Map();
for (const d of divisiones) {
  const puntos = puntosEtapa1PorDivision.get(d.id);
  const ordenados = [...d.equipos].sort((a, b) => puntos.get(b.teamId) - puntos.get(a.teamId));
  const avanzan = ordenados.slice(0, CUPO_ETAPA2);
  const todos = ordenados.map((e) => ({ teamId: e.teamId, puntos: puntos.get(e.teamId) }));
  // La etapa 1 no es un "corte" en el sentido de `corte_por_puesto_auditado`
  // (`cut_position` solo tiene sentido desde la etapa 2), así que no se
  // congela snapshot para ella: se calcula al vuelo con el field de 12, que
  // es exactamente el que corrió.
  finalistasEtapa2.set(d.id, avanzan);
  await confirmarCorte(evento.id, d.id, 2, avanzan.map((e) => e.teamId), todos);
}

// ---------------------------------------------------------------------------
// ETAPA 2 — 2 WODs, corren los que avanzaron de cada categoría.
// ---------------------------------------------------------------------------

console.log("Etapa 2 — 2 WODs (corren los 8 que avanzaron de cada categoría)…");

const wod5 = await crearPrueba(evento.id, idsDivisiones, {
  nombre: "Etapa 2 · WOD 1 — Semifinal de fuerza",
  stage: 2,
  orden: 4,
  parte: { time_scheme: "cap", score_unit: "tiempo", score_dir: "menor_gana", time_cap_ms: 480_000, cap_unit: "reps" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Clean and Jerk", objetivo: [15], kg: 40 }],
});

const wod6 = await crearPrueba(evento.id, idsDivisiones, {
  nombre: "Etapa 2 · WOD 2 — Semifinal AMRAP 10",
  stage: 2,
  orden: 5,
  parte: { time_scheme: "ventana", score_unit: "rondas_reps", score_dir: "mayor_gana", window_ms: 600_000 },
  bloque: { repeticiones: 1 },
  movimientos: [
    { nombre: "Burpee", objetivo: [10] },
    { nombre: "Box Jump", objetivo: [10] },
  ],
});

const puntosEtapa2PorDivision = new Map();

for (const d of divisiones) {
  const equipos = finalistasEtapa2.get(d.id);
  const tabla = puntosDinamicos(CUPO_ETAPA2);
  const puntos = new Map(equipos.map((e) => [e.teamId, 0]));

  for (const wod of [wod5, wod6]) {
    await crearHeatFinalizado(evento.id, d.id, wod.workoutId, equipos);
  }

  {
    const marcas = [];
    for (const e of equipos) {
      const { valor } = generarMarca(wod5.scoreUnit, wod5.dir, e.nivel, { base: 400_000, spread: 150_000, ruido: 25_000 });
      await cargarScore(wod5.partId, e.teamId, { status: "valido", value: valor });
      marcas.push({ teamId: e.teamId, valor });
    }
    for (const { teamId, posicion } of posicionesPorValor(marcas, wod5.dir)) {
      puntos.set(teamId, puntos.get(teamId) + tabla[posicion - 1]);
    }
  }
  {
    const marcas = [];
    for (const e of equipos) {
      const { valor, rondas, reps } = generarMarca(wod6.scoreUnit, wod6.dir, e.nivel, {
        rondasBase: 6,
        rondasSpread: 7,
        repsMax: 15,
      });
      await cargarScore(wod6.partId, e.teamId, { status: "valido", value: rondas, reps });
      marcas.push({ teamId: e.teamId, valor });
    }
    for (const { teamId, posicion } of posicionesPorValor(marcas, wod6.dir)) {
      puntos.set(teamId, puntos.get(teamId) + tabla[posicion - 1]);
    }
  }

  puntosEtapa2PorDivision.set(d.id, puntos);
}

// Corte hacia etapa 3: avanzan los CUPO_ETAPA3 mejores de la semifinal.
const finalistasEtapa3 = new Map();
for (const d of divisiones) {
  const equipos = finalistasEtapa2.get(d.id);
  const puntos = puntosEtapa2PorDivision.get(d.id);
  const ordenados = [...equipos].sort((a, b) => puntos.get(b.teamId) - puntos.get(a.teamId));
  const avanzan = ordenados.slice(0, CUPO_ETAPA3);
  const todos = ordenados.map((e) => ({ teamId: e.teamId, puntos: puntos.get(e.teamId) }));
  finalistasEtapa3.set(d.id, avanzan);
  await confirmarCorte(evento.id, d.id, 3, avanzan.map((e) => e.teamId), todos);
}

// ---------------------------------------------------------------------------
// ETAPA 3 — 1 WOD, define el podio.
// ---------------------------------------------------------------------------

console.log("Etapa 3 — 1 WOD (define el podio de cada categoría)…");

const wod7 = await crearPrueba(evento.id, idsDivisiones, {
  nombre: "Etapa 3 · Final — Snatch máximo",
  stage: 3,
  orden: 6,
  parte: { time_scheme: "sin_reloj", score_unit: "carga", score_dir: "mayor_gana" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Snatch", objetivo: [1] }],
});

const podios = [];
for (const d of divisiones) {
  const finalistas = finalistasEtapa3.get(d.id);
  await crearHeatFinalizado(evento.id, d.id, wod7.workoutId, finalistas);
  const marcas = [];
  for (const e of finalistas) {
    const { valor } = generarMarca(wod7.scoreUnit, wod7.dir, e.nivel, { base: 70, spread: 45, ruido: 6 });
    await cargarScore(wod7.partId, e.teamId, { status: "valido", value: valor });
    marcas.push({ teamId: e.teamId, valor });
  }
  const orden = posicionesPorValor(marcas, wod7.dir).sort((a, b) => a.posicion - b.posicion);
  const porTeamId = new Map(finalistas.map((e) => [e.teamId, e]));
  podios.push({
    categoria: d.name,
    top3: orden.slice(0, 3).map((p) => porTeamId.get(p.teamId)),
  });
}

// Snapshot de etapa 1 recien acá: no es un corte (no tiene cut_position real
// desde el punto de vista del reglamento), pero se deja igual asentado el
// field completo para que la tabla de esa etapa tambien quede legible como
// historica sin depender de recalcular con datos de hoy.
console.log(`
Listo. Competencia finalizada, con podio en las seis categorías.

  Entrá como ${OWNER_EMAIL} / ${CLAVE} → Panel → "Copa Finalizada — Seis
  Categorías" → Leaderboard → Tabla general → elegí la etapa 3 de cada
  categoría para ver el podio.

  Podios:
`);
for (const p of podios) {
  console.log(`  ${p.categoria}:`);
  p.top3.forEach((t, i) => console.log(`    ${i + 1}. #${t.bib} ${t.nombre}`));
}
console.log(`
  Cada categoría corrió: Etapa 1 (4 WODs, ${CUPO_ETAPA1} atletas) → corte a
  ${CUPO_ETAPA2} → Etapa 2 (2 WODs) → corte a ${CUPO_ETAPA3} → Etapa 3 (1 WOD,
  define el podio de arriba). Los cortes de la etapa 2 y 3 quedaron
  CONGELADOS (\`locked_at\`), igual que en una competencia real ya cerrada.
`);
