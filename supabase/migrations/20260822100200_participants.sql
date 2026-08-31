-- Participantes: atletas, equipos y dorsales.
--
-- "Equipo" es la unidad que compite y que rankea: un equipo de 1 integrante es
-- un individual, uno de 2 es una pareja. Modelarlo asi evita duplicar toda la
-- logica de resultados entre individuales y parejas.

create type public.athlete_gender as enum ('male', 'female', 'other');

create type public.team_status as enum (
  'registered',  -- inscripto
  'checked_in',  -- se presento el dia del evento
  'withdrawn'    -- no se presento o se retiro antes de iniciar
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null check (length(trim(last_name)) > 0),
  birth_date date,
  gender public.athlete_gender,
  email text,
  phone text,
  -- Id del sistema de inscripciones del organizador, para reconciliar el CSV.
  external_ref text,
  created_at timestamptz not null default now(),
  unique (id, event_id)
);

create index athletes_event_idx on public.athletes (event_id);
create unique index athletes_external_ref_idx
  on public.athletes (event_id, external_ref)
  where external_ref is not null;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  division_id uuid not null,
  -- Opcional: en individuales la UI muestra el nombre del atleta.
  name text,
  bib_number int not null check (bib_number > 0),
  status public.team_status not null default 'registered',
  created_at timestamptz not null default now(),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete restrict,
  unique (event_id, bib_number),
  unique (id, event_id)
);

create index teams_division_idx on public.teams (division_id);

create table public.team_members (
  team_id uuid not null,
  athlete_id uuid not null,
  event_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (team_id, athlete_id),
  foreign key (team_id, event_id) references public.teams (id, event_id) on delete cascade,
  foreign key (athlete_id, event_id)
    references public.athletes (id, event_id) on delete cascade
);

create index team_members_athlete_idx on public.team_members (athlete_id);

-- ---------------------------------------------------------------------------
-- Validacion de la configuracion
-- ---------------------------------------------------------------------------
--
-- Deliberadamente NO son constraints. Un equipo de parejas se arma insertando
-- integrantes de a uno: una constraint que exija team_size exacto fallaria en
-- el primer insert y haria imposible cualquier import por CSV.
--
-- En vez de eso, el organizador consulta esta funcion antes de pasar el evento
-- a "ready" y ve todo lo que falta de una. Es tambien lo que alimenta la torre
-- de control de la fase 6.

create or replace function public.event_config_issues(p_event_id uuid)
returns table (severity text, code text, detail text)
language sql
stable
set search_path = public, pg_temp
as $$
  -- Divisiones cuyo circuito no tiene ningun segmento cargado.
  select
    'error'::text,
    'division_sin_segmentos'::text,
    format('La division "%s" usa un circuito sin segmentos.', d.name)
  from public.divisions d
  where d.event_id = p_event_id
    and not exists (
      select 1 from public.segments s where s.course_template_id = d.course_template_id
    )

  union all

  -- Equipos con mas o menos integrantes de los que pide su division.
  select
    'error'::text,
    'equipo_incompleto'::text,
    format(
      'El dorsal %s tiene %s integrante(s) y su division "%s" exige %s.',
      t.bib_number, coalesce(m.cantidad, 0), d.name, d.team_size
    )
  from public.teams t
  join public.divisions d on d.id = t.division_id
  left join (
    select team_id, count(*)::int as cantidad
    from public.team_members
    group by team_id
  ) m on m.team_id = t.id
  where t.event_id = p_event_id
    and t.status <> 'withdrawn'
    and coalesce(m.cantidad, 0) <> d.team_size

  union all

  -- Parejas mixtas que no tienen un integrante de cada sexo.
  select
    'error'::text,
    'mixta_invalida'::text,
    format('El dorsal %s esta en una division mixta pero no tiene un integrante de cada sexo.', t.bib_number)
  from public.teams t
  join public.divisions d on d.id = t.division_id
  where t.event_id = p_event_id
    and d.gender_rule = 'mixed'
    and t.status <> 'withdrawn'
    and (
      (select count(*) from public.team_members tm
       join public.athletes a on a.id = tm.athlete_id
       where tm.team_id = t.id and a.gender = 'male') < 1
      or
      (select count(*) from public.team_members tm
       join public.athletes a on a.id = tm.athlete_id
       where tm.team_id = t.id and a.gender = 'female') < 1
    )

  union all

  -- Divisiones de un solo sexo con alguien que no corresponde.
  select
    'error'::text,
    'sexo_no_corresponde'::text,
    format('El dorsal %s tiene integrantes que no corresponden a la division "%s".', t.bib_number, d.name)
  from public.teams t
  join public.divisions d on d.id = t.division_id
  where t.event_id = p_event_id
    and d.gender_rule in ('male', 'female')
    and t.status <> 'withdrawn'
    and exists (
      select 1 from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
        and a.gender is distinct from d.gender_rule::text::public.athlete_gender
    )

  union all

  -- Divisiones sin nadie inscripto: no es un error, pero conviene avisarlo
  -- antes de armar heats.
  select
    'warning'::text,
    'division_vacia'::text,
    format('La division "%s" no tiene equipos inscriptos.', d.name)
  from public.divisions d
  where d.event_id = p_event_id
    and not exists (select 1 from public.teams t where t.division_id = d.id)

  union all

  -- Atletas sin fecha de nacimiento en divisiones con rango de edad.
  select
    'warning'::text,
    'edad_desconocida'::text,
    format('%s %s compite en "%s", que tiene rango de edad, pero no tiene fecha de nacimiento.',
           a.first_name, a.last_name, d.name)
  from public.team_members tm
  join public.athletes a on a.id = tm.athlete_id
  join public.teams t on t.id = tm.team_id
  join public.divisions d on d.id = t.division_id
  where tm.event_id = p_event_id
    and a.birth_date is null
    and (d.age_min is not null or d.age_max is not null);
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.athletes enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create policy athletes_read on public.athletes
  for select using (public.event_role(event_id) is not null);
create policy athletes_write on public.athletes
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy teams_read on public.teams
  for select using (public.event_role(event_id) is not null);
create policy teams_write on public.teams
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy team_members_read on public.team_members
  for select using (public.event_role(event_id) is not null);
create policy team_members_write on public.team_members
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.athletes to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update, delete on public.team_members to authenticated;
grant execute on function public.event_config_issues(uuid) to authenticated;
