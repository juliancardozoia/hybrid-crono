-- Arenas, cronograma y colaboradores.
--
-- DOS PROBLEMAS DISTINTOS QUE APARECEN EL MISMO DIA
--
-- 1. Un CrossFit corre varias pruebas EN SIMULTANEO en escenarios distintos —
--    la pista, la piscina, la cancha— y cada categoria pasa por todos. Una
--    carrera hibrida usa un solo escenario y no se entera de nada de esto.
--
-- 2. El dia de la competencia no alcanza con el organizador: hay gente que
--    carga resultados, gente que atiende inscripciones y jueces. Hasta ahora el
--    unico modo de darle acceso a alguien era hacerlo miembro de la
--    organizacion, que es demasiado: le daba TODOS los eventos.

-- ---------------------------------------------------------------------------
-- Arenas
-- ---------------------------------------------------------------------------

create table public.arenas (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  order_index int not null default 0 check (order_index >= 0),
  -- Cuanto dura un heat aca, para detectar solapes cuando el organizador no
  -- cargo la hora de fin. Un heat de Hyrox son 90 minutos; uno de un WOD, 15.
  default_heat_minutes int not null default 15 check (default_heat_minutes between 1 and 600),
  created_at timestamptz not null default now(),
  unique (event_id, name),
  unique (id, event_id)
);

create index arenas_event_idx on public.arenas (event_id, order_index);

alter table public.heats
  add column arena_id uuid,
  add column scheduled_end_at timestamptz;

alter table public.heats
  add constraint heats_arena_fk
  foreign key (arena_id, event_id)
  references public.arenas (id, event_id)
  -- SET NULL acotado a la columna: una FK compuesta con SET NULL a secas anula
  -- tambien event_id, que es NOT NULL.
  on delete set null (arena_id),
  add constraint heats_horario_coherente
    check (scheduled_at is null or scheduled_end_at is null or scheduled_at < scheduled_end_at);

create index heats_cronograma_idx on public.heats (event_id, scheduled_at);

-- ---------------------------------------------------------------------------
-- Colaboradores del evento
-- ---------------------------------------------------------------------------
--
-- Un colaborador tiene acceso a UN evento, no a la organizacion entera. Tiene
-- que estar registrado en la plataforma: se lo invita por correo y queda
-- pendiente hasta que entra, igual que las invitaciones de organizacion.

create type public.event_staff_role as enum (
  'manager',      -- administra este evento, como un admin pero acotado
  'verifier',     -- larga heats, verifica y publica resultados
  'scorekeeper',  -- carga resultados a mano
  'registrar',    -- atiende inscripciones y pagos
  'judge'         -- juzga carriles
);

create table public.event_staff (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Null mientras la invitacion esta pendiente.
  user_id uuid references auth.users (id) on delete cascade,
  invited_email text not null check (position('@' in invited_email) > 1),
  role public.event_staff_role not null default 'judge',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index event_staff_email_unico
  on public.event_staff (event_id, lower(invited_email));
create unique index event_staff_usuario_unico
  on public.event_staff (event_id, user_id) where user_id is not null;
create index event_staff_usuario_idx on public.event_staff (user_id) where user_id is not null;

-- Cuando alguien se registra, sus invitaciones pendientes se enlazan solas.
-- Mismo mecanismo que accept_pending_invitations para las organizaciones.
create or replace function public.aceptar_invitaciones_de_staff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.event_staff
  set user_id = new.id, accepted_at = now()
  where user_id is null and lower(invited_email) = lower(new.email);
  return new;
end;
$$;

create trigger on_profile_created_accept_staff
  after insert on public.profiles
  for each row execute function public.aceptar_invitaciones_de_staff();

-- ---------------------------------------------------------------------------
-- Los permisos
-- ---------------------------------------------------------------------------
--
-- POR QUE SE REDEFINE event_role EN VEZ DE TOCAR TREINTA POLITICAS
--
-- Casi toda politica de lectura del proyecto dice `event_role(event_id) is not
-- null`. Si el colaborador no pasara por ahi, habria que reescribirlas una por
-- una y bastaria olvidarse de una para dejarlo sin ver algo que necesita.
--
-- Asi que event_role sigue devolviendo el rol de organizacion cuando lo hay, y
-- si no, traduce el rol de colaborador al equivalente MAS BAJO que le sirva
-- para leer. Los permisos finos de escritura los deciden los can_* de abajo, no
-- esta traduccion: un `registrar` lee como un juez y ademas puede tocar
-- inscripciones, pero no puede publicar resultados.

create or replace function public.event_staff_role(p_event_id uuid)
returns public.event_staff_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.role from public.event_staff s
  where s.event_id = p_event_id and s.user_id = auth.uid();
$$;

create or replace function public.event_role(p_event_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select m.role from public.events e
      join public.org_members m on m.org_id = e.org_id
      where e.id = p_event_id and m.user_id = auth.uid()
    ),
    case public.event_staff_role(p_event_id)
      when 'manager' then 'admin'::public.org_role
      when 'verifier' then 'head_judge'::public.org_role
      -- Cargar resultados o atender inscripciones no da derecho a verificar ni
      -- a publicar: para leer alcanza con el rol mas bajo.
      when 'scorekeeper' then 'judge'::public.org_role
      when 'registrar' then 'judge'::public.org_role
      when 'judge' then 'judge'::public.org_role
      else null
    end
  );
$$;

-- Quien puede cargar resultados a mano.
create or replace function public.can_score_event(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.can_verify_event(p_event_id)
    or public.event_staff_role(p_event_id) = 'scorekeeper',
    false
  );
$$;

-- Quien puede atender inscripciones y confirmar pagos.
create or replace function public.can_register_event(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.can_manage_event(p_event_id)
    or public.event_staff_role(p_event_id) = 'registrar',
    false
  );
$$;

-- Invita a alguien a colaborar en un evento.
create or replace function public.invite_event_staff(
  p_event_id uuid,
  p_email text,
  p_role public.event_staff_role default 'judge'
)
returns public.event_staff
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_fila public.event_staff;
begin
  if not coalesce(public.can_manage_event(p_event_id), false) then
    raise exception 'Solo la organización puede invitar colaboradores'
      using errcode = 'insufficient_privilege';
  end if;

  if position('@' in v_email) < 2 then
    raise exception 'El correo no es válido';
  end if;

  insert into public.event_staff (event_id, invited_email, role, invited_by, user_id, accepted_at)
  values (
    p_event_id, v_email, p_role, auth.uid(),
    -- Si ya tiene cuenta queda enlazado de una: entra y ve el evento.
    (select id from public.profiles where lower(email) = v_email),
    case when exists (select 1 from public.profiles where lower(email) = v_email)
         then now() else null end
  )
  on conflict (event_id, lower(invited_email)) do update set role = excluded.role
  returning * into v_fila;

  return v_fila;
end;
$$;

create or replace function public.remove_event_staff(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  select event_id into v_event_id from public.event_staff where id = p_staff_id;
  if v_event_id is null then return; end if;

  if not coalesce(public.can_manage_event(v_event_id), false) then
    raise exception 'Solo la organización puede quitar colaboradores'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.event_staff where id = p_staff_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Conflictos del cronograma
-- ---------------------------------------------------------------------------
--
-- Lo que de verdad arruina un dia de competencia no es un horario feo: es que
-- dos heats se pisen en la misma arena, que un juez este anotado en dos lugares
-- a la vez, o que un atleta tenga que correr dos pruebas en simultaneo.
--
-- El fin de un heat sale de scheduled_end_at, y si no esta, de la duracion por
-- defecto de su arena. Adivinar una duracion razonable es mejor que no detectar
-- nada: nadie carga las horas de fin.

create or replace function public.event_schedule_issues(p_event_id uuid)
returns table (severity text, code text, detail text)
language sql
stable
set search_path = public, pg_temp
as $$
  with programados as (
    select
      h.id, h.name, h.arena_id, h.scheduled_at,
      coalesce(
        h.scheduled_end_at,
        h.scheduled_at + make_interval(mins => coalesce(a.default_heat_minutes, 15))
      ) as fin,
      a.name as arena
    from public.heats h
    left join public.arenas a on a.id = h.arena_id
    where h.event_id = p_event_id and h.scheduled_at is not null
  )
  -- Dos heats pisandose en la misma arena.
  select
    'error'::text,
    'arena_solapada'::text,
    format('"%s" y "%s" se pisan en %s.', a.name, b.name, coalesce(a.arena, 'la misma arena'))
  from programados a
  join programados b
    on b.id > a.id
   and a.arena_id is not distinct from b.arena_id
   and a.arena_id is not null
   and a.scheduled_at < b.fin and b.scheduled_at < a.fin

  union all

  -- El mismo juez en dos lugares a la vez.
  select distinct
    'error'::text,
    'juez_solapado'::text,
    format('%s está asignado a "%s" y "%s" al mismo tiempo.',
           coalesce(p.full_name, p.email, 'Un juez'), a.name, b.name)
  from programados a
  join programados b on b.id > a.id
   and a.scheduled_at < b.fin and b.scheduled_at < a.fin
  join public.lanes la on la.heat_id = a.id and la.judge_id is not null
  join public.lanes lb on lb.heat_id = b.id and lb.judge_id = la.judge_id
  left join public.profiles p on p.id = la.judge_id

  union all

  -- El mismo atleta en dos pruebas simultaneas.
  select distinct
    'error'::text,
    'atleta_solapado'::text,
    format('El dorsal %s corre en "%s" y "%s" al mismo tiempo.', t.bib_number, a.name, b.name)
  from programados a
  join programados b on b.id > a.id
   and a.scheduled_at < b.fin and b.scheduled_at < a.fin
  join public.lanes la on la.heat_id = a.id and la.team_id is not null
  join public.lanes lb on lb.heat_id = b.id and lb.team_id = la.team_id
  join public.teams t on t.id = la.team_id

  union all

  -- Heats sin hora: no es un error, pero no entran al cronograma.
  select
    'warning'::text,
    'heat_sin_horario'::text,
    format('"%s" no tiene hora programada.', h.name)
  from public.heats h
  where h.event_id = p_event_id and h.scheduled_at is null

  union all

  -- Heats sin arena, cuando el evento tiene mas de una.
  select
    'warning'::text,
    'heat_sin_arena'::text,
    format('"%s" no tiene arena asignada.', h.name)
  from public.heats h
  where h.event_id = p_event_id
    and h.arena_id is null
    and (select count(*) from public.arenas where event_id = p_event_id) > 1;
$$;

-- ---------------------------------------------------------------------------
-- El evento tiene que ser visible para su colaborador
-- ---------------------------------------------------------------------------
--
-- `events_read` miraba la ORGANIZACION (`user_org_role(org_id)`), no el evento.
-- Con eso, un colaborador que no es miembro de la organizacion no podia leer ni
-- el evento en el que colabora — y todo lo demas cuelga de ahi: el panel carga
-- el evento primero y sin el no muestra nada.
--
-- Es el precio de haber tenido un solo nivel de acceso hasta ahora. Se corrige
-- en las dos politicas que preguntan por la organizacion en vez de por el
-- evento.

drop policy events_read on public.events;

create policy events_read on public.events
  for select using (
    public.user_org_role(org_id) is not null
    or public.event_staff_role(id) is not null
  );

drop policy events_update on public.events;

-- Un `manager` de evento administra ESE evento, incluida su ficha.
create policy events_update on public.events
  for update using (public.can_manage_event(id))
  with check (public.can_manage_event(id));

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.arenas enable row level security;
alter table public.event_staff enable row level security;

create policy arenas_read on public.arenas
  for select using (public.event_role(event_id) is not null);
create policy arenas_write on public.arenas
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- Un colaborador ve la lista de colaboradores del evento: saber quien mas esta
-- trabajando el mismo dia es parte de trabajar ahi.
create policy event_staff_read on public.event_staff
  for select using (public.event_role(event_id) is not null or user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

revoke all on public.arenas from anon, authenticated;
revoke all on public.event_staff from anon, authenticated;

grant select, insert, update, delete on public.arenas to authenticated;
-- Sin insert ni update: las altas y bajas pasan por las funciones, que validan
-- el permiso y normalizan el correo.
grant select on public.event_staff to authenticated;

select public.apply_function_lockdown();
