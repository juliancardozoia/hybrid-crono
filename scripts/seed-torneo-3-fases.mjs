/**
 * Siembra para ver, con nombres y números concretos, un comportamiento del
 * modelo de etapas que resulta contraintuitivo la primera vez que se lo mira:
 *
 *   node scripts/seed-torneo-3-fases.mjs
 *
 * CADA ETAPA PUNTUA SOLA. `buildScoreboard()` (src/shared/scoring/scoreboard.ts)
 * arma una tabla POR (categoria, etapa): la tabla de la final solo suma los
 * puntos de los WODs de la final, sin arrastrar nada de la semifinal ni de la
 * clasificatoria. Con una final de UN solo WOD, esa tabla ES el resultado de
 * ese WOD: quien gana la final encabeza la tabla de esa etapa aunque haya
 * entrado por el último cupo, y quien ganó la semifinal no se lleva ninguna
 * ventaja de puntos a la final. No es un bug — es el mismo patron que usan los
 * CrossFit Games en formato de cortes: cada corte resetea el campo.
 *
 * Arma UNA competencia con tres fases:
 *
 *   Fase 1 — Clasificatoria: 3 WODs, 20 atletas de "Rx Masculino".
 *   Fase 2 — Semifinal: 1 WOD. Avanzan los 8 mejores de la fase 1 (por puntos
 *            acumulados de sus 3 WODs).
 *   Fase 3 — Final: 1 WOD. Avanzan los 6 mejores de la SEMIFINAL.
 *
 * Y fuerza a proposito el caso que se pidio ver:
 *
 *   - Quien GANO la semifinal sale 3° en la final.
 *   - Quien entro 6° a la final —el ultimo cupo, el mas justo de los que
 *     avanzaron— GANA la final y por lo tanto encabeza la tabla de la fase 3.
 *
 * El resto del campo (los otros 4 finalistas, y los 14 que no llegaron a
 * semifinal) sale de un "nivel" aleatorio por atleta que influye sus tres WODs
 * de la fase 1 de forma consistente, para que el campo se lea coherente y no
 * como puro ruido. Ese nivel NO se usa para nada en la final: ahi las dos
 * marcas clave se fijan a mano, que es todo el punto del ejercicio.
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
const OWNER_EMAIL = "liga.3fases@prueba.com";
const ORG_SLUG = "liga-3-fases-prueba";

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
// Limpieza (mismo patron que seed-dev.mjs y seed-torneo-etapas.mjs).
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
  user_metadata: { full_name: "Dueña de Liga 3 Fases" },
});
if (errorOwner) morir("crear el dueño", errorOwner);

const [org] = await insertar("organizations", {
  name: "Liga 3 Fases de Prueba",
  slug: ORG_SLUG,
  created_by: owner.user.id,
});
{
  const { error } = await db.from("organizations").update({ plan: "pro" }).eq("id", org.id);
  if (error) morir("activar el plan pro", error);
}

// ---------------------------------------------------------------------------
// La curva de puntos, igual que en seed-torneo-etapas.mjs.
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

function mezclar(arr) {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// ---------------------------------------------------------------------------
// Nombres.
// ---------------------------------------------------------------------------

const NOMBRES = ["Andrés", "Camilo", "Daniel", "Esteban", "Felipe", "Gabriel", "Héctor", "Iván", "Jorge", "Kevin", "Luis", "Marcos", "Nicolás", "Óscar", "Pablo", "Rodrigo", "Samuel", "Tomás", "Adrián", "Bruno"];
const APELLIDOS = ["Álvarez", "Bermúdez", "Castaño", "Duarte", "Escobar", "Franco", "Gómez", "Herrera", "Ibáñez", "Jaramillo", "Klein", "Lozano", "Molina", "Naranjo", "Ospina", "Peña", "Quintero", "Rueda", "Salazar", "Torres"];

/** Busca un movimiento del catalogo por nombre exacto. */
async function movimiento(nombre) {
  const { data, error } = await db.from("movements").select("id").eq("name", nombre).maybeSingle();
  if (error || !data) morir(`buscar el movimiento "${nombre}"`, error ?? "no está en el catálogo");
  return data.id;
}

/** Una prueba de una sola parte, con su bloque y sus movimientos, y su division. */
async function crearPrueba(eventId, divisionId, { nombre, stage, orden, parte, bloque, movimientos }) {
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
  await insertar("part_divisions", [{ part_id: p.id, division_id: divisionId, event_id: eventId }]);

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
  return { workoutId: w.id, partId: p.id, dir: parte.score_dir };
}

/** Carga un score manual directo en `workout_scores`, igual que en seed-torneo-etapas.mjs. */
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

async function confirmarCorte(eventId, divisionId, stage, teamIds, { locked }) {
  await insertar(
    "stage_advancements",
    teamIds.map((teamId) => ({ event_id: eventId, division_id: divisionId, stage, team_id: teamId })),
    "stage_advancements",
  );
  await insertar(
    "scoring_snapshots",
    [
      {
        event_id: eventId,
        division_id: divisionId,
        stage,
        field_size: teamIds.length,
        points: puntosDinamicos(teamIds.length),
        locked_at: locked ? new Date().toISOString() : null,
      },
    ],
    "scoring_snapshots",
  );
}

// ---------------------------------------------------------------------------
// El evento, la categoria, los atletas.
// ---------------------------------------------------------------------------

const CUPO_CLASIFICATORIA = 20;
const CUPO_SEMIFINAL = 8;
const CUPO_FINAL = 6;

console.log("Creando el evento…");
const [evento] = await insertar("events", {
  org_id: org.id,
  name: "Copa 3 Fases — Quién es el campeón",
  public_slug: "copa-3-fases",
  venue: "Arena Central",
  status: "published",
  format: "crossfit",
  organizer_name: "Liga 3 Fases de Prueba",
  country: "CO",
  city: "Bogotá",
  starts_at: new Date().toISOString(),
  shirt_sizes: ["S", "M", "L"],
});

const [division] = await insertar("divisions", {
  event_id: evento.id,
  name: "Rx Masculino",
  team_size: 1,
  gender_rule: "male",
  course_template_id: null,
});

console.log("Creando atletas…");
const atletas = [];
for (let dorsal = 101; dorsal < 101 + CUPO_CLASIFICATORIA; dorsal += 1) {
  const [atleta] = await insertar("athletes", {
    event_id: evento.id,
    first_name: NOMBRES[dorsal % NOMBRES.length],
    last_name: APELLIDOS[(dorsal * 3) % APELLIDOS.length],
    gender: "male",
  });
  const [equipo] = await insertar("teams", {
    event_id: evento.id,
    division_id: division.id,
    bib_number: dorsal,
  });
  await insertar("team_members", { team_id: equipo.id, athlete_id: atleta.id, event_id: evento.id });
  // Un "nivel" 0..1 por atleta: influye sus tres WODs de fase 1 de forma
  // consistente, para que el campo se lea coherente. No se vuelve a usar
  // despues de la fase 1 -- ni en la semifinal ni en la final, que se fijan
  // aparte a proposito.
  atletas.push({ teamId: equipo.id, nombre: `${atleta.first_name} ${atleta.last_name}`, bib: dorsal, nivel: Math.random() });
}

// ---------------------------------------------------------------------------
// FASE 1 — Clasificatoria: 3 WODs.
// ---------------------------------------------------------------------------

console.log("Fase 1 — Clasificatoria (3 WODs)…");

const fran = await crearPrueba(evento.id, division.id, {
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

const cindy = await crearPrueba(evento.id, division.id, {
  nombre: "Fase 1 · WOD 2 — Cindy",
  stage: 1,
  orden: 1,
  parte: { time_scheme: "ventana", score_unit: "rondas_reps", score_dir: "mayor_gana", window_ms: 1_200_000 },
  bloque: { repeticiones: 1 },
  movimientos: [
    { nombre: "Pull-up", objetivo: [5] },
    { nombre: "Push-up", objetivo: [10] },
    { nombre: "Air Squat", objetivo: [15] },
  ],
});

const deadliftMax = await crearPrueba(evento.id, division.id, {
  nombre: "Fase 1 · WOD 3 — Deadlift máximo",
  stage: 1,
  orden: 2,
  parte: { time_scheme: "sin_reloj", score_unit: "carga", score_dir: "mayor_gana" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Deadlift", objetivo: [1] }],
});

// Fran: mejor nivel -> menos tiempo.
const marcasFran = [];
for (const a of atletas) {
  const valor = Math.round(900_000 - a.nivel * 350_000 - aleatorioEntre(0, 60_000));
  await cargarScore(fran.partId, a.teamId, { status: "valido", value: valor });
  marcasFran.push({ teamId: a.teamId, valor });
}

// Cindy: mejor nivel -> mas rondas.
const marcasCindy = [];
for (const a of atletas) {
  const rondas = Math.max(5, Math.floor(6 + a.nivel * 10 + aleatorioEntre(-1, 1)));
  const reps = Math.floor(aleatorioEntre(0, 20));
  await cargarScore(cindy.partId, a.teamId, { status: "valido", value: rondas, reps });
  marcasCindy.push({ teamId: a.teamId, valor: rondas * 1000 + reps });
}

// Deadlift maximo: mejor nivel -> mas kilos.
const marcasDeadlift = [];
for (const a of atletas) {
  const kg = Math.round((140 + a.nivel * 90 + aleatorioEntre(-10, 10)) * 10) / 10;
  await cargarScore(deadliftMax.partId, a.teamId, { status: "valido", value: kg });
  marcasDeadlift.push({ teamId: a.teamId, valor: kg });
}

// Puntos de fase 1: la MISMA curva que usaria el leaderboard real, aplicada a
// cada WOD por separado (fieldSize = 20) y sumada por atleta.
const tabla20 = puntosDinamicos(CUPO_CLASIFICATORIA);
const puntosFase1 = new Map(atletas.map((a) => [a.teamId, 0]));
for (const marcas of [
  { lista: marcasFran, dir: "menor_gana" },
  { lista: marcasCindy, dir: "mayor_gana" },
  { lista: marcasDeadlift, dir: "mayor_gana" },
]) {
  for (const { teamId, posicion } of posicionesPorValor(marcas.lista, marcas.dir)) {
    puntosFase1.set(teamId, puntosFase1.get(teamId) + tabla20[posicion - 1]);
  }
}

const ordenFase1 = [...atletas].sort((a, b) => puntosFase1.get(b.teamId) - puntosFase1.get(a.teamId));
const semifinalistas = ordenFase1.slice(0, CUPO_SEMIFINAL);

await confirmarCorte(evento.id, division.id, 2, semifinalistas.map((a) => a.teamId), { locked: true });

// ---------------------------------------------------------------------------
// FASE 2 — Semifinal: 1 WOD.
// ---------------------------------------------------------------------------

console.log("Fase 2 — Semifinal (1 WOD)…");

const semifinal = await crearPrueba(evento.id, division.id, {
  nombre: "Fase 2 — Semifinal: Grace",
  stage: 2,
  orden: 3,
  parte: { time_scheme: "cap", score_unit: "tiempo", score_dir: "menor_gana", time_cap_ms: 480_000, cap_unit: "reps" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Clean and Jerk", objetivo: [30], kg: 61 }],
});

const marcasSemi = [];
for (const a of semifinalistas) {
  const valor = Math.round(400_000 - a.nivel * 150_000 - aleatorioEntre(0, 30_000));
  await cargarScore(semifinal.partId, a.teamId, { status: "valido", value: valor });
  marcasSemi.push({ teamId: a.teamId, valor });
}

const posicionesSemi = posicionesPorValor(marcasSemi, "menor_gana");
const porTeamId = new Map(atletas.map((a) => [a.teamId, a]));

const ganadorSemi = porTeamId.get(posicionesSemi.find((p) => p.posicion === 1).teamId);
const sextoSemi = porTeamId.get(posicionesSemi.find((p) => p.posicion === CUPO_FINAL).teamId);
const finalistas = posicionesSemi.slice(0, CUPO_FINAL).map((p) => porTeamId.get(p.teamId));

await confirmarCorte(evento.id, division.id, 3, finalistas.map((a) => a.teamId), { locked: true });

// ---------------------------------------------------------------------------
// FASE 3 — Final: 1 WOD. ACA se fuerza el caso que se pidio ver.
// ---------------------------------------------------------------------------

console.log("Fase 3 — Final (1 WOD)…");

const final = await crearPrueba(evento.id, division.id, {
  nombre: "Fase 3 — Final: Snatch máximo",
  stage: 3,
  orden: 4,
  parte: { time_scheme: "sin_reloj", score_unit: "carga", score_dir: "mayor_gana" },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Snatch", objetivo: [1] }],
});

// Seis valores de carga, ordenados de mejor a peor. El indice 0 es el que
// GANA la final; el indice 2 es el que sale 3°.
const valoresOrdenados = Array.from({ length: CUPO_FINAL }, (_, i) => Math.round((150 - i * 8 - aleatorioEntre(0, 3)) * 10) / 10)
  .sort((a, b) => b - a);

const otrosFinalistas = mezclar(finalistas.filter((a) => a.teamId !== ganadorSemi.teamId && a.teamId !== sextoSemi.teamId));
const indicesLibres = [1, 3, 4, 5]; // 0 y 2 ya estan asignados abajo

const asignacionFinal = new Map();
asignacionFinal.set(sextoSemi.teamId, valoresOrdenados[0]); // GANA la final
asignacionFinal.set(ganadorSemi.teamId, valoresOrdenados[2]); // sale 3°
otrosFinalistas.forEach((a, i) => asignacionFinal.set(a.teamId, valoresOrdenados[indicesLibres[i]]));

for (const a of finalistas) {
  await cargarScore(final.partId, a.teamId, { status: "valido", value: asignacionFinal.get(a.teamId) });
}

const posicionesFinal = posicionesPorValor(
  finalistas.map((a) => ({ teamId: a.teamId, valor: asignacionFinal.get(a.teamId) })),
  "mayor_gana",
);
const posicionDe = (teamId) => posicionesFinal.find((p) => p.teamId === teamId).posicion;

console.log(`
Listo.

  Entrá como ${OWNER_EMAIL} / ${CLAVE} → Panel → "Copa 3 Fases — Quién es el
  campeón" → Leaderboard → Tabla general → categoría "Rx Masculino".

  El caso armado a propósito:

    #${ganadorSemi.bib} ${ganadorSemi.nombre}
      GANÓ la semifinal (Fase 2, 1° lugar) y en la Final (Fase 3) salió
      ${posicionDe(ganadorSemi.teamId)}°.

    #${sextoSemi.bib} ${sextoSemi.nombre}
      Entró ${CUPO_FINAL}° a la final —el último cupo, el más justo de los
      que avanzaron de semifinal— y GANÓ la Final: encabeza la tabla de la
      Fase 3 y es, según este modelo, el "campeón" de esa etapa.

  Por qué: la tabla de cada etapa suma SOLO los puntos de los WODs de ESA
  etapa (buildScoreboard agrupa las pruebas por "stage" y llama a
  computeOverall una vez por cada una). Con una final de un solo WOD, esa
  tabla ES el resultado de ese WOD — no hereda nada de la semifinal.

  Las tres tablas por separado, para comparar:

    Fase 1 (Clasificatoria, 20)  → suma de los 3 WODs, decide quién pasa a semifinal.
    Fase 2 (Semifinal, ${CUPO_SEMIFINAL})       → 1 WOD, decide quién pasa a la final.
    Fase 3 (Final, ${CUPO_FINAL})           → 1 WOD, y ESA es la tabla que un
                                    organizador probablemente muestra como
                                    "resultado final" de la competencia.
`);
