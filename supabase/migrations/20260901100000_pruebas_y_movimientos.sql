-- Pruebas de la competencia, catalogo de movimientos y tablas de puntos.
--
-- LA DECISION QUE GOBIERNA ESTE ARCHIVO
--
-- Una prueba NO se elige de una lista de formatos. Se describe con dos datos
-- independientes:
--
--   1. La ESTRUCTURA — que hace el atleta: bloques, movimientos, rondas,
--      intervalos. Es lo que maneja la pantalla del juez.
--   2. La PUNTUACION — como se convierte en un numero comparable: una unidad de
--      medida y una direccion. Es lo que come el motor de scoring.
--
-- Enumerar formatos seria una carrera perdida: hay mas de veinticinco
-- estructuras de WOD en uso (RFT, chipper, AMRAP con buy-in, EMOM alternado,
-- Tabata, Death By, Fight Gone Bad, reps en el tiempo restante...) y cada
-- temporada aparecen mas. Con estructura + puntuacion, todas son
-- configuraciones y ninguna es un caso especial del codigo.
--
-- El circuito tipo Hyrox entra como un esquema mas (`circuito`), y sigue
-- apoyandose en course_templates/segments sin tocarlas: es la estructura sobre
-- la que corre el unico codigo ya probado en competencia real.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.time_scheme as enum (
  'circuito',    -- circuito continuo tipo Hyrox. Usa course_templates + segments.
  'libre',       -- for time sin limite
  'cap',         -- for time con tope de tiempo
  'ventana',     -- AMRAP: ventana fija, se cuenta lo hecho
  'intervalos',  -- EMOM, Tabata, Fight Gone Bad
  'sin_reloj'    -- carga maxima por intentos
);

create type public.score_unit as enum (
  'tiempo',       -- milisegundos
  'reps',
  'rondas',
  'rondas_reps',  -- rondas completas + reps de la parcial, orden lexicografico
  'carga',        -- kilos
  'distancia',    -- metros
  'calorias',
  'puntos'        -- puntaje directo
);

create type public.score_dir as enum ('menor_gana', 'mayor_gana');

create type public.block_kind as enum ('buy_in', 'trabajo', 'descanso', 'cash_out');

create type public.team_mode as enum (
  'individual',
  'sincronizado',   -- los integrantes ejecutan al unisono
  'alternado',      -- uno trabaja y el otro descansa
  'relevo',         -- se turnan por bloque o ronda
  'reparto_libre'   -- el equipo se divide el trabajo como quiera
);

create type public.movement_unit as enum ('reps', 'metros', 'calorias', 'segundos', 'kg');

create type public.movement_category as enum (
  'levantamiento',
  'gimnastico',
  'monoestructural',
  'odd_object',
  'otro'
);

create type public.capture_mode as enum (
  'manual',   -- alguien del staff escribe el score
  'en_vivo'   -- el juez lo captura con la PWA
);

create type public.tiebreak_source as enum (
  'hito',          -- se registra al cerrar un movimiento marcado dentro del WOD
  'otra_prueba',   -- se toma el score de otra parte
  'manual'
);

-- ---------------------------------------------------------------------------
-- Catalogo de movimientos
-- ---------------------------------------------------------------------------
--
-- Es global y lo administra la plataforma: el organizador SELECCIONA, no crea.
-- Un catalogo compartido es lo que hace posible comparar el mismo movimiento
-- entre eventos, y evita que "Wall Ball", "wallball" y "Wall-ball Shot" sean
-- tres cosas distintas.
--
-- Cuando falta uno, la prueba lo escribe a mano (part_movements.custom_name) y
-- la plataforma lo ve en una bandeja para promoverlo al catalogo.
--
-- Los nombres van en ingles a proposito, contra la convencion de idioma del
-- resto del proyecto: son los nombres que el deporte usa en todo el mundo y los
-- que un juez lee en el pizarron de su box. "Empuje de trineo" no lo escribe
-- nadie.

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,64}$'),
  category public.movement_category not null,
  default_unit public.movement_unit not null default 'reps',
  -- Si admite peso. Un burpee no; un thruster si.
  allows_load boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index movements_category_idx on public.movements (category, name);

insert into public.movements (name, slug, category, default_unit, allows_load)
select
  m.name,
  trim(both '-' from lower(regexp_replace(m.name, '[^a-zA-Z0-9]+', '-', 'g'))),
  m.category::public.movement_category,
  m.unit::public.movement_unit,
  m.load
from (values
  -- Levantamiento con barra
  ('Back Squat', 'levantamiento', 'reps', true),
  ('Front Squat', 'levantamiento', 'reps', true),
  ('Overhead Squat', 'levantamiento', 'reps', true),
  ('Zercher Squat', 'levantamiento', 'reps', true),
  ('Deadlift', 'levantamiento', 'reps', true),
  ('Sumo Deadlift', 'levantamiento', 'reps', true),
  ('Sumo Deadlift High Pull', 'levantamiento', 'reps', true),
  ('Romanian Deadlift', 'levantamiento', 'reps', true),
  ('Clean', 'levantamiento', 'reps', true),
  ('Power Clean', 'levantamiento', 'reps', true),
  ('Squat Clean', 'levantamiento', 'reps', true),
  ('Hang Clean', 'levantamiento', 'reps', true),
  ('Hang Power Clean', 'levantamiento', 'reps', true),
  ('Split Clean', 'levantamiento', 'reps', true),
  ('Clean and Jerk', 'levantamiento', 'reps', true),
  ('Power Clean and Split Jerk', 'levantamiento', 'reps', true),
  ('Snatch', 'levantamiento', 'reps', true),
  ('Power Snatch', 'levantamiento', 'reps', true),
  ('Squat Snatch', 'levantamiento', 'reps', true),
  ('Hang Snatch', 'levantamiento', 'reps', true),
  ('Hang Power Snatch', 'levantamiento', 'reps', true),
  ('Split Snatch', 'levantamiento', 'reps', true),
  ('Muscle Snatch', 'levantamiento', 'reps', true),
  ('Snatch Balance', 'levantamiento', 'reps', true),
  ('Shoulder Press', 'levantamiento', 'reps', true),
  ('Push Press', 'levantamiento', 'reps', true),
  ('Push Jerk', 'levantamiento', 'reps', true),
  ('Split Jerk', 'levantamiento', 'reps', true),
  ('Bench Press', 'levantamiento', 'reps', true),
  ('Thruster', 'levantamiento', 'reps', true),
  ('Barbell Front-rack Lunge', 'levantamiento', 'reps', true),
  ('Barbell Overhead Walking Lunge', 'levantamiento', 'reps', true),
  ('Good Morning', 'levantamiento', 'reps', true),
  ('Bear Complex', 'levantamiento', 'reps', true),
  -- Mancuernas
  ('Dumbbell Snatch', 'levantamiento', 'reps', true),
  ('Dumbbell Clean', 'levantamiento', 'reps', true),
  ('Dumbbell Power Clean', 'levantamiento', 'reps', true),
  ('Dumbbell Hang Clean', 'levantamiento', 'reps', true),
  ('Dumbbell Hang Power Clean', 'levantamiento', 'reps', true),
  ('Dumbbell Power Snatch', 'levantamiento', 'reps', true),
  ('Dumbbell Squat Snatch', 'levantamiento', 'reps', true),
  ('Dumbbell Deadlift', 'levantamiento', 'reps', true),
  ('Dumbbell Thruster', 'levantamiento', 'reps', true),
  ('Dumbbell Push Press', 'levantamiento', 'reps', true),
  ('Dumbbell Push Jerk', 'levantamiento', 'reps', true),
  ('Dumbbell Front Squat', 'levantamiento', 'reps', true),
  ('Dumbbell Overhead Squat', 'levantamiento', 'reps', true),
  ('Dumbbell Front-rack Lunge', 'levantamiento', 'reps', true),
  ('Dumbbell Overhead Walking Lunge', 'levantamiento', 'reps', true),
  ('Dumbbell Box Step-up', 'levantamiento', 'reps', true),
  ('Dumbbell Turkish Get-up', 'levantamiento', 'reps', true),
  ('Devil Press', 'levantamiento', 'reps', true),
  ('Dumbbell Farmers Carry', 'levantamiento', 'metros', true),
  -- Pesa rusa
  ('Kettlebell Swing', 'levantamiento', 'reps', true),
  ('Russian Kettlebell Swing', 'levantamiento', 'reps', true),
  ('Kettlebell Snatch', 'levantamiento', 'reps', true),
  ('Kettlebell Clean', 'levantamiento', 'reps', true),
  ('Kettlebell Goblet Squat', 'levantamiento', 'reps', true),
  ('Kettlebell Turkish Get-up', 'levantamiento', 'reps', true),
  -- Balon
  ('Wall-ball Shot', 'levantamiento', 'reps', true),
  ('Medicine-Ball Clean', 'levantamiento', 'reps', true),
  ('Slam Ball', 'levantamiento', 'reps', true),
  -- Gimnasticos: tiron
  ('Pull-up', 'gimnastico', 'reps', false),
  ('Strict Pull-up', 'gimnastico', 'reps', false),
  ('Kipping Pull-up', 'gimnastico', 'reps', false),
  ('Butterfly Pull-up', 'gimnastico', 'reps', false),
  ('Chest-to-bar Pull-up', 'gimnastico', 'reps', false),
  ('Strict Chest-to-bar Pull-up', 'gimnastico', 'reps', false),
  ('L Pull-up', 'gimnastico', 'reps', false),
  ('Bar Muscle-up', 'gimnastico', 'reps', false),
  ('Strict Bar Muscle-up', 'gimnastico', 'reps', false),
  ('Ring Muscle-up', 'gimnastico', 'reps', false),
  ('Strict Ring Muscle-up', 'gimnastico', 'reps', false),
  ('Ring Row', 'gimnastico', 'reps', false),
  ('Rope Climb', 'gimnastico', 'reps', false),
  ('Legless Rope Climb', 'gimnastico', 'reps', false),
  ('L-sit Rope Climb', 'gimnastico', 'reps', false),
  ('Pull-over', 'gimnastico', 'reps', false),
  ('Skin the Cat', 'gimnastico', 'reps', false),
  -- Gimnasticos: empuje e invertidos
  ('Push-up', 'gimnastico', 'reps', false),
  ('Ring Push-up', 'gimnastico', 'reps', false),
  ('Handstand Push-up', 'gimnastico', 'reps', false),
  ('Strict Handstand Push-up', 'gimnastico', 'reps', false),
  ('Kipping Handstand Push-up', 'gimnastico', 'reps', false),
  ('Deficit Handstand Push-up', 'gimnastico', 'reps', false),
  ('Freestanding Handstand Push-up', 'gimnastico', 'reps', false),
  ('Handstand Walk', 'gimnastico', 'metros', false),
  ('Handstand Hold', 'gimnastico', 'segundos', false),
  ('Wall Walk', 'gimnastico', 'reps', false),
  ('Ring Dip', 'gimnastico', 'reps', false),
  ('Dip', 'gimnastico', 'reps', false),
  ('Shoot-through', 'gimnastico', 'reps', false),
  -- Gimnasticos: core
  ('Toes-to-bar', 'gimnastico', 'reps', false),
  ('Strict Toes-to-bar', 'gimnastico', 'reps', false),
  ('Toes-to-rings', 'gimnastico', 'reps', false),
  ('Knees-to-elbows', 'gimnastico', 'reps', false),
  ('Sit-up', 'gimnastico', 'reps', false),
  ('AbMat Sit-up', 'gimnastico', 'reps', false),
  ('GHD Sit-up', 'gimnastico', 'reps', false),
  ('GHD Back Extension', 'gimnastico', 'reps', false),
  ('GHD Hip Extension', 'gimnastico', 'reps', false),
  ('Hollow Hold', 'gimnastico', 'segundos', false),
  ('L-sit', 'gimnastico', 'segundos', false),
  ('L-sit on Rings', 'gimnastico', 'segundos', false),
  ('Hanging L-sit', 'gimnastico', 'segundos', false),
  ('Plank Hold', 'gimnastico', 'segundos', false),
  ('Windshield Wiper', 'gimnastico', 'reps', false),
  ('Back Scale', 'gimnastico', 'segundos', false),
  ('Front Scale', 'gimnastico', 'segundos', false),
  -- Gimnasticos: piernas y saltos
  ('Air Squat', 'gimnastico', 'reps', false),
  ('Single-leg Squat (Pistol)', 'gimnastico', 'reps', false),
  ('Walking Lunge', 'gimnastico', 'reps', false),
  ('Box Jump', 'gimnastico', 'reps', false),
  ('Box Jump Over', 'gimnastico', 'reps', false),
  ('Box Step-up', 'gimnastico', 'reps', false),
  ('Box Step-over', 'gimnastico', 'reps', false),
  ('Broad Jump', 'gimnastico', 'reps', false),
  ('Burpee', 'gimnastico', 'reps', false),
  ('Bar-facing Burpee', 'gimnastico', 'reps', false),
  ('Burpee Box Jump-over', 'gimnastico', 'reps', false),
  ('Burpee Over the Bar', 'gimnastico', 'reps', false),
  ('Burpee Broad Jump', 'gimnastico', 'reps', false),
  ('Inverted Burpee', 'gimnastico', 'reps', false),
  -- Monoestructurales
  ('Run', 'monoestructural', 'metros', false),
  ('Shuttle Run', 'monoestructural', 'metros', false),
  ('Row', 'monoestructural', 'metros', false),
  ('Ski Erg', 'monoestructural', 'metros', false),
  ('BikeErg', 'monoestructural', 'calorias', false),
  ('Assault Bike', 'monoestructural', 'calorias', false),
  ('Echo Bike', 'monoestructural', 'calorias', false),
  ('Swim', 'monoestructural', 'metros', false),
  ('Double-under', 'monoestructural', 'reps', false),
  ('Single-under', 'monoestructural', 'reps', false),
  ('Crossover', 'monoestructural', 'reps', false),
  -- Objetos raros y acarreos
  ('Sled Push', 'odd_object', 'metros', true),
  ('Sled Pull', 'odd_object', 'metros', true),
  ('Farmers Carry', 'odd_object', 'metros', true),
  ('Sandbag Carry', 'odd_object', 'metros', true),
  ('Sandbag Clean', 'odd_object', 'reps', true),
  ('Sandbag Over Shoulder', 'odd_object', 'reps', true),
  ('D-Ball Over Shoulder', 'odd_object', 'reps', true),
  ('Atlas Stone', 'odd_object', 'reps', true),
  ('Tire Flip', 'odd_object', 'reps', true),
  ('Yoke Carry', 'odd_object', 'metros', true),
  ('Bucket Carry', 'odd_object', 'metros', true),
  ('Overhead Carry', 'odd_object', 'metros', true),
  ('Log Clean and Press', 'odd_object', 'reps', true),
  ('Worm Clean', 'odd_object', 'reps', true)
) as m(name, category, unit, load);

-- ---------------------------------------------------------------------------
-- Tablas de puntos
-- ---------------------------------------------------------------------------
--
-- Las tablas estandar (CF-Games 40, CF-Games 80, CF-Open) NO se copian aca: se
-- referencian por `builtin_key` y sus valores viven en el codigo, en
-- src/shared/scoring/points.ts. Si estuvieran en los dos lados, tarde o
-- temprano difieren y el podio dependeria de cual de las dos leyo cada
-- pantalla. Solo las tablas que arma un organizador guardan sus puntos.

create table public.scoring_tables (
  id uuid primary key default gen_random_uuid(),
  -- null = tabla global de la plataforma.
  org_id uuid references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  builtin_key text check (builtin_key ~ '^[a-z0-9_]{2,32}$'),
  points numeric(8, 2)[] not null default '{}',
  created_at timestamptz not null default now(),
  -- O es una tabla del codigo, o trae sus propios puntos. Nunca las dos ni
  -- ninguna: una tabla vacia y sin clave no sabe repartir nada.
  constraint tabla_builtin_o_propia check (
    (builtin_key is not null) <> (array_length(points, 1) is not null)
  ),
  unique (org_id, name)
);

insert into public.scoring_tables (org_id, name, builtin_key) values
  (null, 'Tiempo total', 'tiempo_total'),
  (null, 'CF-Games 40', 'cf_games_40'),
  (null, 'CF-Games 80', 'cf_games_80'),
  (null, 'CF-Open', 'cf_open');

-- ---------------------------------------------------------------------------
-- Pruebas
-- ---------------------------------------------------------------------------

-- Lo que se agenda y lo que juzga una persona de corrido.
create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  order_index int not null check (order_index >= 0),
  name text not null check (length(trim(name)) > 0),
  description text,
  created_at timestamptz not null default now(),
  unique (event_id, order_index),
  unique (event_id, name),
  unique (id, event_id)
);

create index workouts_event_idx on public.workouts (event_id, order_index);

-- Lo que se puntua y rankea.
--
-- Existe separada de `workouts` porque una prueba puede tener dos partes (un
-- AMRAP y despues una carga maxima): se agendan juntas y las juzga la misma
-- persona, pero cada una da su propio score y sus propios puntos. Con una sola
-- parte —el caso de Hyrox y el de la mayoria de los WODs— la UI esconde la
-- distincion.
create table public.workout_parts (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null,
  event_id uuid not null,
  order_index int not null check (order_index >= 0),
  -- "A", "B", o vacio cuando la prueba tiene una sola parte.
  label text not null default '',
  time_scheme public.time_scheme not null,
  capture_mode public.capture_mode not null default 'manual',

  -- La puntuacion: unidad + direccion. No hay enum de "tipo de prueba".
  score_unit public.score_unit not null,
  score_dir public.score_dir not null,

  time_cap_ms int check (time_cap_ms > 0),
  -- En que unidad se mide a quien capea. El cap siempre es "mayor gana": un cap
  -- medido en "menos es mejor" no existe en ningun formato real.
  cap_unit public.score_unit,

  tiebreak_source public.tiebreak_source,
  tiebreak_unit public.score_unit,
  tiebreak_dir public.score_dir,
  tiebreak_part_id uuid,

  window_ms int check (window_ms > 0),
  interval_ms int check (interval_ms > 0),
  team_mode public.team_mode not null default 'individual',
  created_at timestamptz not null default now(),

  unique (workout_id, order_index),
  unique (id, event_id),

  constraint parts_ventana_necesita_duracion
    check (time_scheme <> 'ventana' or window_ms is not null),
  constraint parts_intervalos_necesita_intervalo
    check (time_scheme <> 'intervalos' or interval_ms is not null),
  constraint parts_cap_necesita_unidad
    check (time_cap_ms is null or cap_unit is not null),
  constraint parts_tiebreak_completo
    check (
      tiebreak_source is null
      or (tiebreak_unit is not null and tiebreak_dir is not null)
    ),
  constraint parts_tiebreak_otra_prueba
    check (tiebreak_source <> 'otra_prueba' or tiebreak_part_id is not null),

  foreign key (workout_id, event_id)
    references public.workouts (id, event_id) on delete cascade,
  -- SET NULL acotado a la columna: una FK compuesta con SET NULL a secas
  -- anula tambien event_id, que es NOT NULL.
  foreign key (tiebreak_part_id, event_id)
    references public.workout_parts (id, event_id) on delete set null (tiebreak_part_id)
);

create index workout_parts_workout_idx on public.workout_parts (workout_id, order_index);
create index workout_parts_event_idx on public.workout_parts (event_id);

-- Que categoria corre que parte, y con que parametros propios.
--
-- Es obligatoria y explicita. "Vacio = todas las categorias" haria imposible
-- responder "a quien le falta cargar score", que es la pantalla entera de la
-- carga manual. La UI siembra todas al crear la prueba; sacar una es un click.
create table public.part_divisions (
  part_id uuid not null,
  division_id uuid not null,
  event_id uuid not null,
  -- Solo para time_scheme = 'circuito'. Elite y Open pueden correr circuitos
  -- distintos del mismo Hyrox: por eso el circuito cuelga de (parte, division)
  -- y no de la parte.
  course_template_id uuid,
  time_cap_ms int check (time_cap_ms > 0),
  scoring_table_id uuid references public.scoring_tables (id) on delete set null,
  primary key (part_id, division_id),
  foreign key (part_id, event_id)
    references public.workout_parts (id, event_id) on delete cascade,
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade,
  foreign key (course_template_id, event_id)
    references public.course_templates (id, event_id) on delete restrict
);

create index part_divisions_division_idx on public.part_divisions (division_id);

-- ---------------------------------------------------------------------------
-- Estructura de un WOD
-- ---------------------------------------------------------------------------

-- Un bloque es una tanda de trabajo que se repite N veces. Un chipper es un
-- bloque con repeticiones = 1 y diez movimientos; Fran es uno con
-- repeticiones = 3; un buy-in es un bloque aparte antes del principal.
create table public.part_blocks (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null,
  event_id uuid not null,
  order_index int not null check (order_index >= 0),
  kind public.block_kind not null default 'trabajo',
  label text,
  -- Las rondas del bloque.
  repeticiones int not null default 1 check (repeticiones between 1 and 200),
  -- Para intervalos: cuanto dura cada repeticion y cuanto se descansa entre una
  -- y otra. Tabata es 20000 / 10000 con repeticiones = 8.
  duracion_ms int check (duracion_ms > 0),
  descanso_ms int check (descanso_ms >= 0),
  team_mode public.team_mode,
  created_at timestamptz not null default now(),
  unique (part_id, order_index),
  unique (id, event_id),
  foreign key (part_id, event_id)
    references public.workout_parts (id, event_id) on delete cascade
);

create index part_blocks_part_idx on public.part_blocks (part_id, order_index);

create table public.part_movements (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null,
  part_id uuid not null,
  event_id uuid not null,
  order_index int not null check (order_index >= 0),
  -- Uno de los dos: del catalogo, o escrito a mano cuando falta.
  movement_id uuid references public.movements (id) on delete restrict,
  custom_name text check (custom_name is null or length(trim(custom_name)) > 0),
  unit public.movement_unit not null default 'reps',
  -- Un valor por ronda. Longitud 1 = igual en todas.
  -- {21,15,9} es Fran; {1,2,3,4,...} es Death By. Las escaleras ascendentes y
  -- descendentes salen de aca sin ninguna tabla extra.
  target_per_round int[] not null default '{1}'
    check (array_length(target_per_round, 1) >= 1),
  load_kg numeric(7, 2) check (load_kg >= 0),
  -- El atleta hace las que pueda en el tiempo restante (Nicole, Fight Gone Bad).
  max_reps boolean not null default false,
  -- El hito de desempate. El juez NO da un tap extra: al cerrar este movimiento
  -- se registra el elapsed. Es la regla real de los Games.
  es_tiebreak boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (block_id, order_index),
  unique (id, event_id),
  constraint movimiento_tiene_nombre
    check ((movement_id is not null) <> (custom_name is not null)),
  foreign key (block_id, event_id)
    references public.part_blocks (id, event_id) on delete cascade,
  foreign key (part_id, event_id)
    references public.workout_parts (id, event_id) on delete cascade
);

create index part_movements_block_idx on public.part_movements (block_id, order_index);
create index part_movements_part_idx on public.part_movements (part_id);

-- Rx contra Scaled: el mismo movimiento con otro peso u otras reps segun la
-- categoria. Es el equivalente de division_segment_specs para los WODs.
create table public.division_movement_specs (
  division_id uuid not null,
  part_movement_id uuid not null,
  event_id uuid not null,
  target_per_round int[],
  load_kg numeric(7, 2) check (load_kg >= 0),
  notes text,
  primary key (division_id, part_movement_id),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade,
  foreign key (part_movement_id, event_id)
    references public.part_movements (id, event_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Mismo patron que competition_config: cualquier miembro del evento lee (el
-- juez necesita la estructura del WOD en su pantalla), solo owner y admin
-- escriben.
--
-- El catalogo de movimientos y las tablas globales son la excepcion: los lee
-- cualquier usuario logueado y no los escribe nadie por esta via. El ABM lo
-- hace la plataforma con el service role.

alter table public.movements enable row level security;
alter table public.scoring_tables enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_parts enable row level security;
alter table public.part_divisions enable row level security;
alter table public.part_blocks enable row level security;
alter table public.part_movements enable row level security;
alter table public.division_movement_specs enable row level security;

create policy movements_read on public.movements
  for select using (auth.uid() is not null);

create policy scoring_tables_read on public.scoring_tables
  for select using (
    org_id is null or coalesce(public.user_org_role(org_id) is not null, false)
  );
create policy scoring_tables_write on public.scoring_tables
  for all using (org_id is not null and public.can_admin_org(org_id))
  with check (org_id is not null and public.can_admin_org(org_id));

create policy workouts_read on public.workouts
  for select using (public.event_role(event_id) is not null);
create policy workouts_write on public.workouts
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy workout_parts_read on public.workout_parts
  for select using (public.event_role(event_id) is not null);
create policy workout_parts_write on public.workout_parts
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy part_divisions_read on public.part_divisions
  for select using (public.event_role(event_id) is not null);
create policy part_divisions_write on public.part_divisions
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy part_blocks_read on public.part_blocks
  for select using (public.event_role(event_id) is not null);
create policy part_blocks_write on public.part_blocks
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy part_movements_read on public.part_movements
  for select using (public.event_role(event_id) is not null);
create policy part_movements_write on public.part_movements
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy division_movement_specs_read on public.division_movement_specs
  for select using (public.event_role(event_id) is not null);
create policy division_movement_specs_write on public.division_movement_specs
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
--
-- Explicitos aunque lockdown_grants ya revoco los default privileges: el costo
-- es una linea y el costo de equivocarse es anon leyendo el padron.

revoke all on public.movements from anon, authenticated;
revoke all on public.scoring_tables from anon, authenticated;
revoke all on public.workouts from anon, authenticated;
revoke all on public.workout_parts from anon, authenticated;
revoke all on public.part_divisions from anon, authenticated;
revoke all on public.part_blocks from anon, authenticated;
revoke all on public.part_movements from anon, authenticated;
revoke all on public.division_movement_specs from anon, authenticated;

-- El catalogo se lee, no se escribe desde la app.
grant select on public.movements to authenticated;
grant select, insert, update, delete on public.scoring_tables to authenticated;
grant select, insert, update, delete on public.workouts to authenticated;
grant select, insert, update, delete on public.workout_parts to authenticated;
grant select, insert, update, delete on public.part_divisions to authenticated;
grant select, insert, update, delete on public.part_blocks to authenticated;
grant select, insert, update, delete on public.part_movements to authenticated;
grant select, insert, update, delete on public.division_movement_specs to authenticated;

select public.apply_function_lockdown();
