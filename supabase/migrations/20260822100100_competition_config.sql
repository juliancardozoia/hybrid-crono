-- Configuracion de la competencia: circuito, divisiones y penalizaciones.
--
-- Todas las tablas de aca llevan event_id aunque sea derivable. No es
-- denormalizacion perezosa: las politicas RLS necesitan llegar al evento sin
-- encadenar joins, y las FK compuestas de mas abajo impiden que ese event_id
-- se desincronice del padre.

create type public.segment_kind as enum ('run', 'station', 'transition');

create type public.gender_rule as enum (
  'male',    -- individual masculino o pareja masculina
  'female',  -- individual femenino o pareja femenina
  'mixed',   -- pareja mixta: exige un integrante de cada sexo
  'any'      -- categoria abierta
);

create type public.penalty_kind as enum (
  'time_add',  -- suma segundos al tiempo bruto
  'no_rep',    -- se repite el movimiento, no suma tiempo
  'dq'         -- descalifica
);

-- ---------------------------------------------------------------------------
-- Circuito
-- ---------------------------------------------------------------------------

create table public.course_templates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  -- Redundante con la PK, pero habilita la FK compuesta desde segments.
  unique (id, event_id)
);

create index course_templates_event_idx on public.course_templates (event_id);

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  course_template_id uuid not null,
  event_id uuid not null,
  order_index int not null check (order_index >= 0),
  kind public.segment_kind not null,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  -- La FK compuesta garantiza que el event_id de un segmento siempre coincida
  -- con el de su plantilla. Sin esto, un update descuidado podria dejar un
  -- segmento apuntando a un evento y su plantilla a otro, y RLS quedaria
  -- autorizando contra el evento equivocado.
  foreign key (course_template_id, event_id)
    references public.course_templates (id, event_id) on delete cascade,
  unique (course_template_id, order_index),
  unique (id, event_id)
);

create index segments_template_idx on public.segments (course_template_id, order_index);

-- ---------------------------------------------------------------------------
-- Divisiones (categorias)
-- ---------------------------------------------------------------------------

create table public.divisions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- 1 = individual, 2 = parejas. Se deja abierto por si aparecen equipos.
  team_size int not null default 1 check (team_size between 1 and 8),
  gender_rule public.gender_rule not null default 'any',
  -- Ambos null = categoria abierta.
  age_min int check (age_min between 0 and 120),
  age_max int check (age_max between 0 and 120),
  level text,
  course_template_id uuid not null,
  created_at timestamptz not null default now(),
  constraint divisions_age_range check (
    age_min is null or age_max is null or age_min <= age_max
  ),
  constraint divisions_mixed_needs_team check (
    gender_rule <> 'mixed' or team_size > 1
  ),
  foreign key (course_template_id, event_id)
    references public.course_templates (id, event_id) on delete restrict,
  unique (event_id, name),
  unique (id, event_id)
);

create index divisions_event_idx on public.divisions (event_id);

-- Los pesos y distancias cambian por division: el mismo Sled Push es 152kg en
-- elite y 102kg en open. El segmento es el mismo, la exigencia no.
create table public.division_segment_specs (
  division_id uuid not null,
  segment_id uuid not null,
  event_id uuid not null,
  target_reps int check (target_reps > 0),
  load_kg numeric(6, 2) check (load_kg >= 0),
  distance_m numeric(8, 2) check (distance_m >= 0),
  notes text,
  primary key (division_id, segment_id),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade,
  foreign key (segment_id, event_id)
    references public.segments (id, event_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Penalizaciones
-- ---------------------------------------------------------------------------

create table public.penalty_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_]{2,32}$'),
  label text not null check (length(trim(label)) > 0),
  kind public.penalty_kind not null,
  seconds int not null default 0 check (seconds >= 0),
  -- Si esta seteado, la penalizacion solo aplica a ese segmento.
  scope_segment_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- Una penalizacion de tiempo sin segundos no penaliza nada, y una de tipo
  -- no_rep o dq con segundos confunde al juez sobre que va a pasar.
  constraint penalty_seconds_match_kind check (
    (kind = 'time_add' and seconds > 0) or (kind <> 'time_add' and seconds = 0)
  ),
  foreign key (scope_segment_id, event_id)
    references public.segments (id, event_id) on delete cascade,
  unique (event_id, code)
);

create index penalty_types_event_idx on public.penalty_types (event_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Mismo patron en las cuatro tablas: cualquier miembro del evento lee (el juez
-- necesita el circuito y el catalogo de penalizaciones en su pantalla), pero
-- solo owner y admin escriben.

alter table public.course_templates enable row level security;
alter table public.segments enable row level security;
alter table public.divisions enable row level security;
alter table public.division_segment_specs enable row level security;
alter table public.penalty_types enable row level security;

create policy course_templates_read on public.course_templates
  for select using (public.event_role(event_id) is not null);
create policy course_templates_write on public.course_templates
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy segments_read on public.segments
  for select using (public.event_role(event_id) is not null);
create policy segments_write on public.segments
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy divisions_read on public.divisions
  for select using (public.event_role(event_id) is not null);
create policy divisions_write on public.divisions
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy division_segment_specs_read on public.division_segment_specs
  for select using (public.event_role(event_id) is not null);
create policy division_segment_specs_write on public.division_segment_specs
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy penalty_types_read on public.penalty_types
  for select using (public.event_role(event_id) is not null);
create policy penalty_types_write on public.penalty_types
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.course_templates to authenticated;
grant select, insert, update, delete on public.segments to authenticated;
grant select, insert, update, delete on public.divisions to authenticated;
grant select, insert, update, delete on public.division_segment_specs to authenticated;
grant select, insert, update, delete on public.penalty_types to authenticated;
