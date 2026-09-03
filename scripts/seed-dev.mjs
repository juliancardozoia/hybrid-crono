/**
 * Datos de prueba para tocar la app en local.
 *
 *   node scripts/seed-dev.mjs
 *
 * Crea de cero lo que hace falta para recorrer TODO el producto: usuarios que
 * pueden iniciar sesion, una organizacion, una carrera hibrida lista para
 * cronometrar y un CrossFit con sus pruebas. Es lo que en los tests hace
 * `seedScenario`, pero contra la base real y con nombres que se leen.
 *
 * NO es idempotente y no pretende serlo: esta pensado para correrse sobre una
 * base recien reseteada. Si encuentra la organizacion ya creada, avisa y sale
 * en vez de duplicar todo.
 *
 * Usa el service role, asi que SALTEA RLS a proposito: sembrar no es el camino
 * que hay que probar, y hacerlo pasando por las politicas obligaria a firmar
 * sesion por cada usuario para escribir sus filas.
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
const USUARIOS = [
  { email: "organizador@prueba.com", nombre: "Ana Organizadora", rol: "owner" },
  { email: "juez1@prueba.com", nombre: "Bruno Juez", rol: "judge" },
  { email: "juez2@prueba.com", nombre: "Carla Jueza", rol: "judge" },
  // Dueño de la SEGUNDA organizacion, la del plan Pro. Va aparte a proposito:
  // si las dos colgaran del mismo dueño, su panel mostraria dos y no se
  // entenderia cual de los dos planes esta viendo.
  { email: "productora@prueba.com", nombre: "Liga Andina", rol: "owner" },
];

/** Las dos organizaciones que siembra el script, para poder limpiarlas. */
const SLUGS_DE_ORG = ["box-prueba", "liga-andina"];

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

// Se puede correr las veces que haga falta: primero borra lo que dejo la
// corrida anterior. Un seed que hay que limpiar a mano se deja de usar al
// segundo intento.
/**
 * Borra una organizacion y todo lo suyo, en orden de dependencia.
 *
 * NO alcanza con `delete from organizations`, aunque casi todo cuelgue por
 * `on delete cascade`. Hay FKs `on delete restrict` cuyo padre y cuya hija
 * mueren en la MISMA cascada —part_divisions -> course_templates, teams ->
 * divisions, heats/lanes -> workouts, y timing_events -> timing_events por
 * `supersedes_id`— y RESTRICT se comprueba INMEDIATAMENTE: cuando mira, la hija
 * todavia esta ahi, y aborta el borrado entero con un mensaje que nombra una
 * tabla intermedia y no dice ni "evento" ni "borrar".
 *
 * Cambiarlas a `no action` NO alcanza (probado): la cola de triggers del
 * statement dispara la comprobacion antes de que la cascada llegue a la hija.
 * Haria falta `deferrable initially deferred`, que degrada la atribucion de
 * errores en toda la app por una operacion que el panel todavia no ofrece.
 *
 * Asi que se borra en orden a mano. Cuando el panel de super admin ofrezca
 * "eliminar competencia", esto tiene que volverse una funcion de Postgres.
 */
async function borrarOrganizacion(orgId) {
  const { data: eventos } = await db.from("events").select("id").eq("org_id", orgId);
  for (const { id } of eventos ?? []) {
    // De la hoja a la raiz. Las que faltan caen por cascade sin estorbar.
    for (const tabla of [
      "timing_events",
      "results",
      "lanes",
      "heats",
      "arenas",
      "workout_scores",
      "division_movement_specs",
      "part_movements",
      "part_blocks",
      "part_divisions",
      "workout_parts",
      "workouts",
      // Los trámites de inscripción apuntan a la categoría con `restrict`, así
      // que van ANTES que ella o la cascada se aborta.
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

const { data: previa } = await db
  .from("organizations")
  .select("id")
  .in("slug", SLUGS_DE_ORG);
if (previa?.length) {
  console.log("Borrando la siembra anterior…");
  for (const { id } of previa) await borrarOrganizacion(id);
  const { data: lista } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const u of lista?.users ?? []) {
    if (USUARIOS.some((x) => x.email === u.email)) await db.auth.admin.deleteUser(u.id);
  }
}

console.log("Creando usuarios…");
const ids = {};
for (const u of USUARIOS) {
  // `email_confirm: true` evita el correo de verificacion: en local no hay
  // servidor de correo y sin esto no se puede iniciar sesion.
  const { data, error } = await db.auth.admin.createUser({
    email: u.email,
    password: CLAVE,
    email_confirm: true,
    user_metadata: { full_name: u.nombre },
  });
  if (error) morir(`crear ${u.email}`, error);
  ids[u.email] = data.user.id;
  console.log(`   ${u.email}`);
}

const owner = ids["organizador@prueba.com"];

console.log("Creando organización…");
const [org] = await insertar("organizations", {
  name: "Box de Prueba",
  slug: "box-prueba",
  created_by: owner,
});

// El dueno NO se agrega aca: lo hace el trigger `add_creator_as_owner` al
// crear la organizacion. Existe porque la politica de lectura exige membresia,
// y sin el, quien crea su organizacion no la puede ver.
await insertar("org_members", [
  { org_id: org.id, user_id: ids["juez1@prueba.com"], role: "judge" },
  { org_id: org.id, user_id: ids["juez2@prueba.com"], role: "judge" },
]);

// ---------------------------------------------------------------------------
// Carrera hibrida, lista para cronometrar
// ---------------------------------------------------------------------------

const enUnaHora = new Date(Date.now() + 60 * 60 * 1000).toISOString();

console.log("Creando la carrera híbrida…");
const [hibrida] = await insertar("events", {
  org_id: org.id,
  name: "Copa Híbrida de Prueba",
  public_slug: "copa-hibrida",
  venue: "Coliseo Central",
  status: "live",
  format: "carrera_hibrida",
  organizer_name: "Box de Prueba",
  country: "CO",
  city: "Medellín",
  starts_at: enUnaHora,
  shirt_sizes: ["S", "M", "L", "XL"],
});

// Circuito corto a proposito: seis segmentos se cronometran de punta a punta en
// un minuto, y probar el offline con dieciseis es un castigo innecesario.
const [circuito] = await insertar("course_templates", {
  event_id: hibrida.id,
  name: "Circuito corto",
});

await insertar(
  "segments",
  [
    ["run", "500m Run"],
    ["station", "SkiErg 500m"],
    ["run", "500m Run"],
    ["station", "Sled Push 25m"],
    ["run", "500m Run"],
    ["station", "Wall Balls 50"],
  ].map(([kind, name], i) => ({
    course_template_id: circuito.id,
    event_id: hibrida.id,
    order_index: i,
    kind,
    name,
  })),
);

await insertar(
  "penalty_types",
  [
    { code: "ROM", label: "Rango de movimiento", kind: "time_add", seconds: 10 },
    { code: "ZONA", label: "Fuera de zona", kind: "time_add", seconds: 15 },
    { code: "CONDUCTA", label: "Conducta antideportiva", kind: "dq", seconds: 0 },
  ].map((p) => ({ ...p, event_id: hibrida.id })),
);

const divisiones = await insertar("divisions", [
  {
    event_id: hibrida.id,
    name: "Individual Masculino RX",
    team_size: 1,
    gender_rule: "male",
    course_template_id: circuito.id,
  },
  {
    event_id: hibrida.id,
    name: "Individual Femenino RX",
    team_size: 1,
    gender_rule: "female",
    course_template_id: circuito.id,
  },
]);

const NOMBRES = [
  ["Diego", "Ramírez", "male"],
  ["Mateo", "Ospina", "male"],
  ["Julián", "Peña", "male"],
  ["Sofía", "Cardona", "female"],
  ["Valentina", "Ríos", "female"],
  ["Camila", "Herrera", "female"],
];

console.log("Creando atletas y equipos…");
let bib = 101;
const equipos = [];
for (const [nombre, apellido, sexo] of NOMBRES) {
  const division = divisiones.find((d) => d.gender_rule === sexo);
  const [atleta] = await insertar("athletes", {
    event_id: hibrida.id,
    first_name: nombre,
    last_name: apellido,
    gender: sexo,
  });
  const [equipo] = await insertar("teams", {
    event_id: hibrida.id,
    division_id: division.id,
    bib_number: bib,
  });
  await insertar("team_members", {
    team_id: equipo.id,
    athlete_id: atleta.id,
    event_id: hibrida.id,
  });
  equipos.push({ ...equipo, division_id: division.id });
  bib += 1;
}

console.log("Armando heats y carriles…");
for (const division of divisiones) {
  const suyos = equipos.filter((e) => e.division_id === division.id);
  const [heat] = await insertar("heats", {
    event_id: hibrida.id,
    division_id: division.id,
    name: `Heat ${division.gender_rule === "male" ? "1" : "2"}`,
    lane_count: suyos.length,
  });
  await insertar(
    "lanes",
    suyos.map((equipo, i) => ({
      heat_id: heat.id,
      event_id: hibrida.id,
      lane_number: i + 1,
      team_id: equipo.id,
    })),
  );
}

// ---------------------------------------------------------------------------
// CrossFit, en borrador
// ---------------------------------------------------------------------------
//
// Queda en `draft` a proposito: con el plan gratuito la organizacion corre UNA
// competencia a la vez, y la hibrida ya esta en vivo. Intentar pasarla a "lista"
// es la forma mas rapida de ver el limite del plan funcionando.

console.log("Creando el CrossFit…");
const [crossfit] = await insertar("events", {
  org_id: org.id,
  name: "Throwdown de Prueba",
  public_slug: "throwdown-prueba",
  venue: "Box de Prueba",
  status: "draft",
  format: "crossfit",
  organizer_name: "Box de Prueba",
  country: "CO",
  city: "Bogotá",
  starts_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  shirt_sizes: ["S", "M", "L"],
});

// SIN circuito, y es lo correcto: una categoria de CrossFit no corre UN
// circuito, corre N pruebas. `divisions.course_template_id` se volvio nullable
// justo para esto.
//
// Ademas es necesario: darle un circuito dispara `divisions_entra_al_circuito`,
// que le crea al evento una prueba "Circuito" en order_index 0 — y despues las
// pruebas de abajo chocan con ese indice.
const [rx] = await insertar("divisions", {
  event_id: crossfit.id,
  name: "Rx Masculino",
  team_size: 1,
  gender_rule: "male",
  course_template_id: null,
});

/** Busca un movimiento del catalogo por nombre exacto. */
async function movimiento(nombre) {
  const { data, error } = await db.from("movements").select("id").eq("name", nombre).maybeSingle();
  if (error || !data) morir(`buscar el movimiento "${nombre}"`, error ?? "no está en el catálogo");
  return data.id;
}

/** Crea una prueba de una sola parte con sus bloques y movimientos. */
async function prueba({ nombre, orden, parte, bloque, movimientos }) {
  const [w] = await insertar("workouts", {
    event_id: crossfit.id,
    order_index: orden,
    name: nombre,
  });
  const [p] = await insertar("workout_parts", {
    workout_id: w.id,
    event_id: crossfit.id,
    order_index: 0,
    ...parte,
  });
  await insertar("part_divisions", {
    part_id: p.id,
    division_id: rx.id,
    event_id: crossfit.id,
  });
  const [b] = await insertar("part_blocks", {
    part_id: p.id,
    event_id: crossfit.id,
    order_index: 0,
    kind: "trabajo",
    ...bloque,
  });
  for (const [i, m] of movimientos.entries()) {
    await insertar("part_movements", {
      block_id: b.id,
      part_id: p.id,
      event_id: crossfit.id,
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

// Fran: 21-15-9 de thrusters y pull-ups. El caso que hace evidente para qué
// sirve `target_per_round`.
await prueba({
  nombre: "Evento 1 — Fran",
  orden: 0,
  parte: {
    time_scheme: "cap",
    score_unit: "tiempo",
    score_dir: "menor_gana",
    time_cap_ms: 10 * 60 * 1000,
    cap_unit: "reps",
  },
  bloque: { repeticiones: 3 },
  movimientos: [
    { nombre: "Thruster", objetivo: [21, 15, 9], kg: 43 },
    { nombre: "Pull-up", objetivo: [21, 15, 9] },
  ],
});

// Cindy: AMRAP de 20 minutos. La ventana en su forma más simple.
await prueba({
  nombre: "Evento 2 — Cindy",
  orden: 1,
  parte: {
    time_scheme: "ventana",
    score_unit: "rondas_reps",
    score_dir: "mayor_gana",
    window_ms: 20 * 60 * 1000,
  },
  bloque: { repeticiones: 1 },
  movimientos: [
    { nombre: "Pull-up", objetivo: [5] },
    { nombre: "Push-up", objetivo: [10] },
    { nombre: "Air Squat", objetivo: [15] },
  ],
});

// Carga máxima: sin reloj, gana el kilaje mayor.
await prueba({
  nombre: "Evento 3 — Clean & Jerk máximo",
  orden: 2,
  parte: {
    time_scheme: "sin_reloj",
    score_unit: "carga",
    score_dir: "mayor_gana",
  },
  bloque: { repeticiones: 1 },
  movimientos: [{ nombre: "Clean and Jerk", objetivo: [1], maxReps: false }],
});

// ---------------------------------------------------------------------------
// Una segunda organizacion, en plan Pro y con competencias PUBLICADAS
// ---------------------------------------------------------------------------
//
// Sin esto el catalogo publico queda vacio y los filtros de la portada no se
// pueden ni mirar: sin un pais publicado no hay pais que ofrecer. Los eventos
// estan repartidos a proposito en tres paises, cuatro ciudades, meses distintos
// y los dos formatos, que es lo unico que hace visible si los filtros filtran.
//
// Va en su propia organizacion para no romper la demostracion del plan
// gratuito: "Box de Prueba" tiene que seguir siendo free.

console.log("Creando la organización del plan Pro…");
const [liga] = await insertar("organizations", {
  name: "Liga Andina",
  slug: "liga-andina",
  created_by: ids["productora@prueba.com"],
});

// El plan pro exige tarjeta registrada: es lo que separa "quiero" de "puedo".
await db.rpc("guardar_medio_de_cobro", {
  p_org_id: liga.id,
  p_provider: "stripe",
  p_card_token: "tok_seed_liga",
  p_card_brand: "visa",
  p_card_last4: "1881",
});
{
  const { error } = await db.from("organizations").update({ plan: "pro" }).eq("id", liga.id);
  if (error) morir("activar el plan pro", error);
}

// Cliente con la sesión de la dueña, para lo que exige `auth.uid()`.
const comoProductora = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
{
  const { error } = await comoProductora.auth.signInWithPassword({
    email: "productora@prueba.com",
    password: CLAVE,
  });
  if (error) morir("iniciar sesión como productora", error);
}

/**
 * Las fechas se calculan HACIA ADELANTE desde hoy, no con meses fijos del año
 * en curso. Con meses fijos, la mitad de los eventos sembrados quedaban en el
 * pasado según cuándo se corriera el script, con las inscripciones cerradas y
 * la ficha sin botón: parecía que la página estaba rota.
 */
function dentroDe(meses, dia = 15) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + meses, dia);
  d.setUTCHours(17, 0, 0, 0);
  return d;
}

/** Nombres para poblar las listas de largada. */
const NOMBRES_H = ["Andrés", "Camilo", "Daniel", "Esteban", "Felipe", "Gabriel", "Héctor", "Iván", "Jorge", "Kevin"];
const NOMBRES_M = ["Ana", "Beatriz", "Carolina", "Daniela", "Elena", "Fernanda", "Gabriela", "Helena", "Isabel", "Juliana"];
const APELLIDOS = ["Álvarez", "Bermúdez", "Castaño", "Duarte", "Escobar", "Franco", "Gómez", "Herrera", "Ibáñez", "Jaramillo"];
const EQUIPOS = ["Los Invencibles", "Fuerza Bruta", "Sin Excusas", "Doble o Nada", "Team Titan", "Los Últimos", "Hierro y Fuego", "Sin Miedo"];

/**
 * Inscribe equipos en cada categoría, respetando su tamaño, su sexo y su cupo.
 *
 * Escribe directo en `teams` y `athletes` con el service role, sin pasar por
 * `confirm_registration`. Es a propósito: sembrar no es el camino que hay que
 * probar, y hacerlo por el trámite completo obligaría a firmar sesión por cada
 * capitán y a invitar por correo a cada integrante.
 */
async function inscribirEquipos(eventId, divisiones) {
  let dorsal = 101;

  for (const d of divisiones) {
    // Ni tantos que la lista sea ilegible, ni tan pocos que no se note el
    // selector de categoría. Y nunca más que el cupo.
    const cuantos = Math.min(d.capacity ?? 6, 6);

    for (let i = 0; i < cuantos; i += 1) {
      const atletas = [];

      for (let m = 0; m < d.teamSize; m += 1) {
        // En una categoría mixta el equipo lleva uno de cada sexo, que es lo
        // que exige `event_config_issues`.
        const sexo =
          d.gender === "mixed" ? (m === 0 ? "male" : "female") : d.gender === "female" ? "female" : "male";
        const pila = sexo === "female" ? NOMBRES_M : NOMBRES_H;

        const [a] = await insertar("athletes", {
          event_id: eventId,
          first_name: pila[(dorsal + m) % pila.length],
          last_name: APELLIDOS[(dorsal + m * 3) % APELLIDOS.length],
          gender: sexo,
        });
        atletas.push(a.id);
      }

      const [t] = await insertar("teams", {
        event_id: eventId,
        division_id: d.id,
        // En individuales el equipo va sin nombre y la lista muestra el del
        // atleta, que es como lo anuncia el speaker.
        name: d.teamSize > 1 ? EQUIPOS[dorsal % EQUIPOS.length] : null,
        bib_number: dorsal,
      });

      for (const athleteId of atletas) {
        await insertar("team_members", { team_id: t.id, athlete_id: athleteId, event_id: eventId });
      }

      dorsal += 1;
    }
  }
}

/** Un evento publicado, con su categoría, listo para aparecer en el catálogo. */
async function publicado({ nombre, slug, formato, pais, ciudad, sede, enMeses, destacado, precio, cupo }) {
  const [e] = await insertar("events", {
    org_id: liga.id,
    name: nombre,
    public_slug: slug,
    venue: sede,
    status: "ready",
    format: formato,
    organizer_name: "Liga Andina",
    country: pais,
    city: ciudad,
    // Mediodía del huso del evento: el trigger deriva `event_date` desde acá, y
    // a las 00:00 cualquier corrimiento la manda al día anterior.
    starts_at: dentroDe(enMeses).toISOString(),
    // Cierran una semana antes del evento: el margen que usa cualquier
    // organizador para armar heats y pedir las remeras.
    registration_closes_at: new Date(dentroDe(enMeses).getTime() - 7 * 86_400_000).toISOString(),
    shirt_sizes: ["S", "M", "L", "XL"],
    description: "Competencia de la Liga Andina. Inscripciones abiertas.",
    featured_at: destacado ? new Date().toISOString() : null,
  });

  // Una carrera híbrida necesita circuito; un CrossFit no, y darle uno le
  // crearía una prueba "Circuito" que no corre nadie.
  let templateId = null;
  if (formato === "carrera_hibrida") {
    const [t] = await insertar("course_templates", { event_id: e.id, name: "Circuito" });
    for (const [i, [kind, name]] of [
      ["run", "1km Run"],
      ["station", "SkiErg 1000m"],
      ["run", "1km Run"],
      ["station", "Wall Balls 100"],
    ].entries()) {
      await insertar("segments", {
        course_template_id: t.id,
        event_id: e.id,
        order_index: i,
        kind,
        name,
      });
    }
    templateId = t.id;
  }

  // Varias categorías con precios y cupos distintos: es lo que hace visible si
  // la ficha muestra bien "Gratis", "quedan 3" y "cupo ilimitado".
  const CATEGORIAS = [
    { name: "Elite Masculino", gender_rule: "male", team_size: 1, cupo: 40 },
    { name: "Elite Femenino", gender_rule: "female", team_size: 1, cupo: 40 },
    { name: "Intermedio Masculino", gender_rule: "male", team_size: 1, cupo: 4 },
    { name: "Parejas Mixtas", gender_rule: "mixed", team_size: 2, cupo: null },
  ];

  const divisionesCreadas = [];
  for (const c of CATEGORIAS) {
    const [d] = await insertar("divisions", {
      event_id: e.id,
      name: c.name,
      team_size: c.team_size,
      gender_rule: c.gender_rule,
      course_template_id: templateId,
    });

    await insertar("division_registration", {
      division_id: d.id,
      event_id: e.id,
      // La última va sin precio a propósito: sin precio la inscripción se
      // confirma sola, y la ficha tiene que decir "Gratis" y no "$ 0".
      price_cents: precio && c.cupo !== null ? precio * c.team_size : null,
      currency: pais === "BR" ? "BRL" : pais === "CL" ? "CLP" : pais === "PE" ? "PEN" : "COP",
      capacity: cupo === false ? null : c.cupo,
    });

    divisionesCreadas.push({ ...d, teamSize: c.team_size, gender: c.gender_rule });
  }

  // Inscritos, para que la lista de largada tenga algo que mostrar. La pestaña
  // de Leaderboards vive de esto durante los meses previos a la competencia.
  await inscribirEquipos(e.id, divisionesCreadas);

  // `publish_event` es la única puerta al catálogo: valida fecha, categorías y
  // plan. Se llama con la sesión de la dueña y NO con el service role, que no
  // tiene `auth.uid()` y por lo tanto no pasa `can_manage_event`. De paso, así
  // el seed recorre el mismo camino que el organizador desde el panel.
  const { error } = await comoProductora.rpc("publish_event", { p_event_id: e.id });
  if (error) morir(`publicar ${nombre}`, error);
}

console.log("Publicando competencias en el catálogo…");
await publicado({ nombre: "Bogotá Hybrid Open", slug: "bogota-hybrid-open", formato: "carrera_hibrida", pais: "CO", ciudad: "Bogotá", sede: "Corferias", enMeses: 1, destacado: true, precio: 18000000 });
await publicado({ nombre: "Medellín Throwdown", slug: "medellin-throwdown", formato: "crossfit", pais: "CO", ciudad: "Medellín", sede: "Plaza Mayor", enMeses: 3, precio: 25000000 });
await publicado({ nombre: "Lima Fitness Games", slug: "lima-fitness-games", formato: "crossfit", pais: "PE", ciudad: "Lima", sede: "Costa Verde", enMeses: 5, destacado: true, precio: 25000 });
await publicado({ nombre: "Santiago Hybrid Race", slug: "santiago-hybrid-race", formato: "carrera_hibrida", pais: "CL", ciudad: "Santiago", sede: "Parque O'Higgins", enMeses: 7, precio: 4500000 });
await publicado({ nombre: "Quito Winter Throwdown", slug: "quito-winter-throwdown", formato: "crossfit", pais: "EC", ciudad: "Quito", sede: "Arena Norte", enMeses: 9, cupo: false });

// ---------------------------------------------------------------------------
// Una competencia COMPLETA, para ver las cuatro pestañas con datos
// ---------------------------------------------------------------------------
//
// Las pestañas de la ficha aparecen solo cuando tienen contenido: sin heats no
// hay Cronograma, y sin pruebas liberadas no hay Workouts. Sembrar cinco
// eventos vacíos deja la ficha con una sola pestaña y no se puede mirar nada.
//
// Este bloque le pone a una de ellas todo lo que un atleta esperaría encontrar:
// dos escenarios, dos días de heats, y tres pruebas con sus movimientos y los
// pesos de cada categoría.

console.log("Armando el evento completo (arenas, heats y WODs)…");
{
  const { data: ev } = await db
    .from("events")
    .select("id")
    .eq("public_slug", "medellin-throwdown")
    .single();
  const eventId = ev.id;

  // En vivo: es lo que hace aparecer la pestaña de Leaderboards.
  await db.from("events").update({ status: "live" }).eq("id", eventId);

  const { data: divs } = await db.from("divisions").select("id, name").eq("event_id", eventId);
  const porNombre = new Map(divs.map((d) => [d.name, d.id]));

  const arenas = await insertar("arenas", [
    { event_id: eventId, name: "Pista principal", order_index: 0, default_heat_minutes: 20 },
    { event_id: eventId, name: "Zona de fuerza", order_index: 1, default_heat_minutes: 30 },
  ]);

  // --- Las pruebas ---------------------------------------------------------
  //
  // `released_at` en el pasado: ya son públicas. El organizador las carga
  // semanas antes para configurar al juez y decide cuándo revelarlas.
  const PRUEBAS = [
    {
      nombre: "Evento 1 — Fran",
      descripcion: "Clásico de CrossFit. 21-15-9 de thrusters y pull-ups, contra reloj.",
      parte: { time_scheme: "cap", score_unit: "tiempo", score_dir: "menor_gana", time_cap_ms: 600000, cap_unit: "reps" },
      bloque: { repeticiones: 3 },
      movimientos: [
        { nombre: "Thruster", objetivo: [21, 15, 9], kg: 43, specs: { "Elite Masculino": 43, "Elite Femenino": 30, "Intermedio Masculino": 34, "Parejas Mixtas": 34 } },
        { nombre: "Pull-up", objetivo: [21, 15, 9], specs: {} },
      ],
    },
    {
      nombre: "Evento 2 — Cindy",
      descripcion: "AMRAP de 20 minutos. Tantas rondas como puedas.",
      parte: { time_scheme: "ventana", score_unit: "rondas_reps", score_dir: "mayor_gana", window_ms: 1200000 },
      bloque: { repeticiones: 1 },
      movimientos: [
        { nombre: "Pull-up", objetivo: [5], specs: {} },
        { nombre: "Push-up", objetivo: [10], specs: {} },
        { nombre: "Air Squat", objetivo: [15], specs: {} },
      ],
    },
    {
      nombre: "Evento 3 — Clean & Jerk máximo",
      descripcion: "Diez minutos para levantar lo más pesado que puedas. Gana el kilaje mayor.",
      parte: { time_scheme: "sin_reloj", score_unit: "carga", score_dir: "mayor_gana" },
      bloque: { repeticiones: 1 },
      movimientos: [{ nombre: "Clean and Jerk", objetivo: [1], specs: {} }],
    },
  ];

  const pruebasCreadas = [];
  for (const [i, pr] of PRUEBAS.entries()) {
    const [w] = await insertar("workouts", {
      event_id: eventId,
      order_index: i,
      name: pr.nombre,
      description: pr.descripcion,
      released_at: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const [parte] = await insertar("workout_parts", {
      workout_id: w.id,
      event_id: eventId,
      order_index: 0,
      ...pr.parte,
    });

    for (const d of divs) {
      await insertar("part_divisions", { part_id: parte.id, division_id: d.id, event_id: eventId });
    }

    const [b] = await insertar("part_blocks", {
      part_id: parte.id,
      event_id: eventId,
      order_index: 0,
      kind: "trabajo",
      ...pr.bloque,
    });

    for (const [j, m] of pr.movimientos.entries()) {
      const [pm] = await insertar("part_movements", {
        block_id: b.id,
        part_id: parte.id,
        event_id: eventId,
        order_index: j,
        movement_id: await movimiento(m.nombre),
        unit: "reps",
        target_per_round: m.objetivo,
        load_kg: m.kg ?? null,
      });

      // El peso de cada categoría: es el dato por el que un atleta abre esta
      // pantalla, y lo que decide en qué categoría se anota.
      for (const [division, kg] of Object.entries(m.specs)) {
        const divId = porNombre.get(division);
        if (!divId) continue;
        await insertar("division_movement_specs", {
          division_id: divId,
          part_movement_id: pm.id,
          event_id: eventId,
          load_kg: kg,
        });
      }
    }

    pruebasCreadas.push(w.id);
  }

  // --- El cronograma -------------------------------------------------------
  //
  // Dos días, dos escenarios, heats de cada categoría: es la forma que tiene un
  // CrossFit de verdad y lo único que hace visible si el agrupamiento funciona.
  const dia1 = new Date(dentroDe(3));
  const dia2 = new Date(dia1.getTime() + 86_400_000);

  const aLas = (base, hora, minuto) => {
    const d = new Date(base);
    d.setUTCHours(hora + 5, minuto, 0, 0); // 5 = desfase de Bogotá a UTC
    return d;
  };

  let n = 1;
  for (const [dia, prueba] of [
    [dia1, 0],
    [dia1, 1],
    [dia2, 2],
  ]) {
    for (const [k, d] of divs.entries()) {
      const inicio = aLas(dia, 9 + Math.floor((k * 40) / 60), (k * 40) % 60);
      await insertar("heats", {
        event_id: eventId,
        division_id: d.id,
        workout_id: pruebasCreadas[prueba],
        arena_id: arenas[prueba === 2 ? 1 : 0].id,
        name: `Heat ${n++}`,
        lane_count: 8,
        scheduled_at: inicio.toISOString(),
        scheduled_end_at: new Date(inicio.getTime() + 25 * 60_000).toISOString(),
      });
    }
  }
}

console.log(`
Listo.

  Entrá a http://localhost:3000/login con cualquiera de estos:

    organizador@prueba.com   ${CLAVE}    (dueño: ve todo el panel)
    juez1@prueba.com         ${CLAVE}    (juez: toma carriles)
    juez2@prueba.com         ${CLAVE}

  Qué hay armado:

    Copa Híbrida de Prueba   en vivo, 2 heats, 6 dorsales, circuito de 6
                             segmentos. Los jueces toman carril en /juez.
    Throwdown de Prueba      borrador, 3 pruebas (Fran, Cindy, carga máxima)
                             sobre la categoría Rx Masculino.

  Y una segunda organización, Liga Andina, en plan Pro, con 5 competencias
  PUBLICADAS en 4 países y los dos formatos: es lo que llena el catálogo de la
  portada y hace que los filtros tengan algo que filtrar.

  "Medellín Throwdown" está completa: entrá a su ficha para ver las cuatro
  pestañas con datos (2 escenarios, 12 heats en 2 días, 3 WODs con pesos por
  categoría).
  Entrá como productora@prueba.com con la misma clave para verla por dentro.

  Cosas para probar el plan (la organización arranca en gratuito):

    · Pasar el Throwdown a "lista" → rebota: una competencia a la vez.
    · Pruebas → Configurar → "Juzgada en vivo" → rebota: es del plan Pro.
    · Resumen → Catálogo público → dice que no aparece listada.
    · Panel → Plan → registrar tarjeta y activar Pro deja hacer las tres.
`);
