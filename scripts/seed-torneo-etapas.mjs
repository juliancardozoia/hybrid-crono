/**
 * Datos de prueba para ver un CrossFit con ETAPAS (clasificatoria -> semifinal
 * -> final) sin tener que jugar cada heat a mano.
 *
 *   node scripts/seed-torneo-etapas.mjs
 *
 * Escribe los scores DIRECTO en `workout_scores` con `source: 'manual'` y
 * `capture_mode: 'manual'` en cada prueba -- no pasa por el cronometro, por
 * carriles ni por heats. Es a proposito: lo que hay que mirar aca es el motor
 * de puntuacion y el leaderboard, no el camino del juez, que ya prueban
 * `seed-dev.mjs` y los tests de `src/shared/timing/`.
 *
 * Arma DOS competencias, mismo plan Pro (los cortes de etapa son un ejercicio
 * del leaderboard en vivo, y el plan gratuito no muestra nada hasta publicar):
 *
 *   - "Torneo Etapas — En vivo": clasificatoria cerrada, semifinal A MEDIO
 *     JUGAR (la mitad de los que avanzaron todavia no tiene marca) y sin
 *     final. `status: 'live'`.
 *   - "Torneo Etapas — Terminado": las tres etapas completas y sus cortes
 *     CONGELADOS. `status: 'published'`, para ver el podio con el badge
 *     "OFICIAL".
 *
 * Los puntajes son ALEATORIOS PUROS (sin semilla): cada corrida arma un campo
 * y un podio distintos. Es a proposito para esta herramienta -- lo que se
 * quiere ejercitar es que el motor aguante campos y empates variados, no
 * comparar un mismo screenshot entre corridas.
 *
 * NO es idempotente entre corridas... salvo que borra su propia siembra
 * anterior antes de crear: mismo patron que `seed-dev.mjs`, buscando la
 * organizacion por slug.
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
const OWNER_EMAIL = "liga.etapas@prueba.com";
const ORG_SLUG = "liga-etapas-prueba";

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
// Limpieza: identica a la de seed-dev.mjs. Las tablas nuevas de etapas
// (scoring_snapshots, stage_advancements) cuelgan de `divisions`/`teams` con
// on delete cascade, asi que no hace falta agregarlas a la lista.
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
  user_metadata: { full_name: "Dueña de Liga Etapas" },
});
if (errorOwner) morir("crear el dueño", errorOwner);

const [org] = await insertar("organizations", {
  name: "Liga Etapas de Prueba",
  slug: ORG_SLUG,
  created_by: owner.user.id,
});

// Plan Pro escrito directo, igual que seed-dev.mjs: el gate de plan que nos
// importa ejercitar es el del LEADERBOARD (public_scoreboard), no el de
// activar el plan en si.
{
  const { error } = await db.from("organizations").update({ plan: "pro" }).eq("id", org.id);
  if (error) morir("activar el plan pro", error);
}

// ---------------------------------------------------------------------------
// La curva de puntos, reimplementada en JS puro.
//
// Es LA MISMA formula que src/shared/scoring/points.ts (puntosDinamicos) --
// hay un test ahi que la audita contra la tabla literal de los Games 2026.
// Se copia en vez de importarse porque este script corre con node plano
// (.mjs) y el modulo original es TypeScript: traer un bundler para un script
// de siembra es mas costo que trece lineas duplicadas, documentadas para que
// no diverjan en silencio.
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

// ---------------------------------------------------------------------------
// Nombres para que la grilla se lea como gente y no como "Atleta 1".
// ---------------------------------------------------------------------------

const NOMBRES_H = ["Andrés", "Camilo", "Daniel", "Esteban", "Felipe", "Gabriel", "Héctor", "Iván", "Jorge", "Kevin", "Luis", "Marcos"];
const NOMBRES_M = ["Ana", "Beatriz", "Carolina", "Daniela", "Elena", "Fernanda", "Gabriela", "Helena", "Isabel", "Juliana", "Karen", "Laura"];
const APELLIDOS = ["Álvarez", "Bermúdez", "Castaño", "Duarte", "Escobar", "Franco", "Gómez", "Herrera", "Ibáñez", "Jaramillo", "Klein", "Lozano"];

const CATEGORIAS = [
  { name: "Rx Masculino", gender_rule: "male" },
  { name: "Rx Femenino", gender_rule: "female" },
  { name: "Scaled Masculino", gender_rule: "male" },
];

const CUPO_CLASIFICATORIA = 24;
const CUPO_SEMIFINAL = 12;
const CUPO_FINAL = 6;

function aleatorioEntre(min, max) {
  return min + Math.random() * (max - min);
}

/** Mejores `n` de una lista de {teamId, valor}, segun la direccion de la prueba. */
function elegirMejores(entradas, dir, n) {
  const orden = [...entradas].sort((a, b) => (dir === "mayor_gana" ? b.valor - a.valor : a.valor - b.valor));
  return orden.slice(0, n);
}

/** Crea un atleta individual y su equipo en una categoria, con un dorsal. */
async function crearAtleta(eventId, division, dorsal) {
  const esFemenino = division.gender_rule === "female";
  const pila = esFemenino ? NOMBRES_M : NOMBRES_H;
  const [atleta] = await insertar("athletes", {
    event_id: eventId,
    first_name: pila[dorsal % pila.length],
    last_name: APELLIDOS[(dorsal * 3) % APELLIDOS.length],
    gender: esFemenino ? "female" : "male",
  });
  const [equipo] = await insertar("teams", {
    event_id: eventId,
    division_id: division.id,
    bib_number: dorsal,
  });
  await insertar("team_members", { team_id: equipo.id, athlete_id: atleta.id, event_id: eventId });
  return equipo;
}

/** Busca un movimiento del catalogo por nombre exacto. Igual que en seed-dev.mjs. */
async function movimiento(nombre) {
  const { data, error } = await db.from("movements").select("id").eq("name", nombre).maybeSingle();
  if (error || !data) morir(`buscar el movimiento "${nombre}"`, error ?? "no está en el catálogo");
  return data.id;
}

/**
 * Una prueba de una sola parte, con su bloque y sus movimientos.
 *
 * El SCORE se sigue cargando manual y directo en `workout_scores` -- el
 * bloque y los movimientos no los necesita el motor de puntuacion para eso,
 * los necesita el CONSTRUCTOR de la pantalla (`/pruebas/[workoutId]`) y el
 * simulador del juez, que si no quedan vacios y parece que la prueba nunca
 * se termino de cargar.
 */
async function crearPrueba(eventId, { nombre, stage, orden, parte, divisiones, bloque, movimientos }) {
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

  return p;
}

/**
 * Carga un score manual directo en `workout_scores`.
 *
 * No pasa por `upsert_workout_score()` -- esa funcion exige `can_verify_event`
 * via `auth.uid()`, que el service role no tiene -- pero el resultado final es
 * el mismo: el trigger `completar_datos_de_score` completa `event_id`,
 * `division_id` y `score_unit` igual, sea cual sea el camino de escritura.
 */
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

/** El corte de una etapa: quien avanza y la tabla de puntos que se congela. */
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

/**
 * Arma UNA competencia completa: categorias, atletas, clasificatoria para
 * todos, semifinal para quien avanza y --opcional-- una final.
 *
 * `semifinalCompleta` en false dejar la mitad de los semifinalistas SIN marca
 * ("a medio jugar"). `conFinal` en false no crea la tercera prueba.
 */
async function crearTorneo({ nombre, slug, status, semifinalCompleta, conFinal }) {
  console.log(`Creando "${nombre}"…`);
  const [evento] = await insertar("events", {
    org_id: org.id,
    name: nombre,
    public_slug: slug,
    venue: "Arena Central",
    status: "draft", // se sube a `status` recien al final, ver mas abajo
    format: "crossfit",
    organizer_name: "Liga Etapas de Prueba",
    country: "CO",
    city: "Bogotá",
    starts_at: new Date().toISOString(),
    shirt_sizes: ["S", "M", "L"],
  });

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

  const clasificatoria = await crearPrueba(evento.id, {
    nombre: "Clasificatoria — Fran",
    stage: 1,
    orden: 0,
    parte: { time_scheme: "cap", score_unit: "tiempo", score_dir: "menor_gana", time_cap_ms: 600_000, cap_unit: "reps" },
    divisiones,
    bloque: { repeticiones: 3 },
    movimientos: [
      { nombre: "Thruster", objetivo: [21, 15, 9], kg: 43 },
      { nombre: "Pull-up", objetivo: [21, 15, 9] },
    ],
  });

  const semifinal = await crearPrueba(evento.id, {
    nombre: "Semifinal — Cindy (AMRAP)",
    stage: 2,
    orden: 1,
    parte: { time_scheme: "ventana", score_unit: "rondas_reps", score_dir: "mayor_gana", window_ms: 1_200_000 },
    divisiones,
    bloque: { repeticiones: 1 },
    movimientos: [
      { nombre: "Pull-up", objetivo: [5] },
      { nombre: "Push-up", objetivo: [10] },
      { nombre: "Air Squat", objetivo: [15] },
    ],
  });

  const final = conFinal
    ? await crearPrueba(evento.id, {
        nombre: "Final — Clean & Jerk máximo",
        stage: 3,
        orden: 2,
        parte: { time_scheme: "sin_reloj", score_unit: "carga", score_dir: "mayor_gana" },
        divisiones,
        bloque: { repeticiones: 1 },
        movimientos: [{ nombre: "Clean and Jerk", objetivo: [1], maxReps: false }],
      })
    : null;

  let dorsal = 101;

  for (const division of divisiones) {
    // --- Clasificatoria: TODOS corren y TODOS terminan. -------------------
    const equipos = [];
    for (let i = 0; i < CUPO_CLASIFICATORIA; i += 1) {
      equipos.push(await crearAtleta(evento.id, division, dorsal));
      dorsal += 1;
    }

    const marcasClasificatoria = [];
    for (const equipo of equipos) {
      // 8 a 15 minutos: tiempo de un For Time con cap de 10.
      const valor = Math.round(aleatorioEntre(480_000, 900_000));
      await cargarScore(clasificatoria.id, equipo.id, { status: "valido", value: valor });
      marcasClasificatoria.push({ teamId: equipo.id, valor });
    }

    // --- Semifinal: solo quien avanzo, y solo con la etapa 1 ya cerrada. --
    const avanzanASemi = elegirMejores(marcasClasificatoria, "menor_gana", CUPO_SEMIFINAL);
    await confirmarCorte(
      evento.id,
      division.id,
      2,
      avanzanASemi.map((a) => a.teamId),
      { locked: !!conFinal }, // "en vivo" queda sin congelar; "terminado" ya cerro
    );

    const marcasSemifinal = [];
    // "A medio jugar": si la semifinal no esta completa, la mitad de la
    // camada se queda sin marca (status "pendiente" por ausencia de fila,
    // exactamente como lo resuelve rankPart con un equipo sin score).
    const cuantosCorrieron = semifinalCompleta ? avanzanASemi.length : Math.ceil(avanzanASemi.length / 2);
    for (const { teamId } of avanzanASemi.slice(0, cuantosCorrieron)) {
      const rondas = Math.floor(aleatorioEntre(8, 18));
      const reps = Math.floor(aleatorioEntre(0, 20));
      await cargarScore(semifinal.id, teamId, { status: "valido", value: rondas, reps });
      marcasSemifinal.push({ teamId, valor: rondas * 1000 + reps });
    }

    // --- Final: solo si el torneo esta completo. --------------------------
    if (final && marcasSemifinal.length > 0) {
      const avanzanAFinal = elegirMejores(marcasSemifinal, "mayor_gana", CUPO_FINAL);
      await confirmarCorte(
        evento.id,
        division.id,
        3,
        avanzanAFinal.map((a) => a.teamId),
        { locked: true },
      );
      for (const { teamId } of avanzanAFinal) {
        const kg = Math.round(aleatorioEntre(60, 140) * 10) / 10;
        await cargarScore(final.id, teamId, { status: "valido", value: kg });
      }
    }
  }

  const { error } = await db.from("events").update({ status }).eq("id", evento.id);
  if (error) morir("fijar el estado final del evento", error);

  return evento;
}

const enVivo = await crearTorneo({
  nombre: "Torneo Etapas — En vivo",
  slug: "torneo-etapas-en-vivo",
  status: "live",
  semifinalCompleta: false,
  conFinal: false,
});

const terminado = await crearTorneo({
  nombre: "Torneo Etapas — Terminado",
  slug: "torneo-etapas-terminado",
  status: "published",
  semifinalCompleta: true,
  conFinal: true,
});

console.log(`
Listo.

  Entrá como ${OWNER_EMAIL} / ${CLAVE} y mirá:

    Panel → "Torneo Etapas — En vivo" → Leaderboard
      Clasificatoria cerrada, semifinal a medio jugar (a la mitad le falta
      marca), sin final todavía. El corte de semifinal esta SIN congelar.

    Panel → "Torneo Etapas — Terminado" → Leaderboard
      Las tres etapas completas, el podio de la Final, y el badge "OFICIAL"
      (el evento quedo en 'published').

  Vista pública, sin sesión:

    http://localhost:3000/en-vivo/${enVivo.public_slug}
    http://localhost:3000/en-vivo/${terminado.public_slug}

  Los puntajes salen de Math.random(): cada corrida de este script arma un
  campo y un podio distintos.
`);
