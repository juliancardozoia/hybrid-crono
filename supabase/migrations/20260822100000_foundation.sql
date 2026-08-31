-- Fundacion: organizaciones, membresias y eventos.
--
-- Multi-tenant por organizacion. Cada box o productora es una organizacion, y
-- todo lo demas cuelga de un evento que pertenece a una organizacion.

-- Sin extensiones: gen_random_uuid() es parte del core desde Postgres 13.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.org_role as enum ('owner', 'admin', 'head_judge', 'judge');

create type public.event_status as enum (
  'draft',      -- el organizador todavia esta configurando
  'ready',      -- configuracion cerrada, listo para correr
  'live',       -- hay heats corriendo
  'verifying',  -- termino, la organizacion esta revisando
  'published'   -- resultados oficiales publicados
);

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,48}$'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'judge',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on public.org_members (user_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  venue text,
  event_date date,
  timezone text not null default 'America/Bogota',
  status public.event_status not null default 'draft',
  -- Slug publico para el leaderboard y las vistas de atleta. Se puede rotar sin
  -- tocar el id, por si hay que cortar el acceso a un link filtrado.
  public_slug text not null unique check (public_slug ~ '^[a-z0-9-]{4,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_org_idx on public.events (org_id);

-- ---------------------------------------------------------------------------
-- Helpers de autorizacion
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER a proposito: estas funciones se llaman DESDE las politicas
-- RLS de las mismas tablas que consultan. Sin definer, org_members se
-- consultaria a si misma con RLS activo y entraria en recursion infinita.

create or replace function public.user_org_role(p_org_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.org_members m
  where m.org_id = p_org_id
    and m.user_id = auth.uid();
$$;

-- Rol del usuario actual dentro del evento. Es el helper que usan casi todas
-- las politicas: evita repetir el join events -> org_members en cada una.
create or replace function public.event_role(p_event_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.events e
  join public.org_members m on m.org_id = e.org_id
  where e.id = p_event_id
    and m.user_id = auth.uid();
$$;

-- Quien puede cambiar la configuracion de una competencia.
--
-- El coalesce NO es cosmetico. Para alguien sin rol, event_role() devuelve null
-- y `null in ('owner','admin')` es NULL, no false. En una politica RLS eso se
-- trata como false y no hay problema, pero en plpgsql `if not NULL then` NO
-- entra al bloque: un guard escrito asi deja pasar a cualquiera que no sea
-- miembro. Devolver siempre un booleano real cierra esa puerta.
create or replace function public.can_manage_event(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(public.event_role(p_event_id) in ('owner', 'admin'), false);
$$;

-- Quien puede corregir o anular marcajes ya registrados.
create or replace function public.can_verify_event(p_event_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    public.event_role(p_event_id) in ('owner', 'admin', 'head_judge'),
    false
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger events_touch_updated_at
before update on public.events
for each row execute function public.touch_updated_at();

-- Quien crea una organizacion queda como owner en el mismo instante.
-- Sin esto, el creador no seria miembro y RLS le impediria leer lo que acaba
-- de crear: la politica de lectura exige membresia.
create or replace function public.add_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (org_id, user_id) do nothing;
  return new;
end;
$$;

create trigger organizations_add_creator
after insert on public.organizations
for each row
when (new.created_by is not null)
execute function public.add_creator_as_owner();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.events enable row level security;

-- El `or created_by = auth.uid()` no es redundante: sin el, `insert ... returning`
-- falla. Postgres exige que la fila devuelta pase tambien la politica de SELECT,
-- y en ese instante el trigger que da de alta la membresia todavia no es visible
-- para la consulta. Es decir: `insert(...).select()`, el patron normal del cliente
-- de Supabase, se rompia al crear la primera organizacion.
create policy organizations_read on public.organizations
  for select using (
    public.user_org_role(id) is not null
    or created_by = auth.uid()
  );

create policy organizations_insert on public.organizations
  for insert with check (created_by = auth.uid());

create policy organizations_update on public.organizations
  for update using (public.user_org_role(id) in ('owner', 'admin'))
  with check (public.user_org_role(id) in ('owner', 'admin'));

create policy organizations_delete on public.organizations
  for delete using (public.user_org_role(id) = 'owner');

-- Todo miembro ve el padron de su organizacion: el juez necesita saber quien es
-- el head judge del evento.
create policy org_members_read on public.org_members
  for select using (public.user_org_role(org_id) is not null);

create policy org_members_write on public.org_members
  for all using (public.user_org_role(org_id) in ('owner', 'admin'))
  with check (public.user_org_role(org_id) in ('owner', 'admin'));

-- Usa org_id, que es una columna de la propia fila, en vez de event_role(id).
-- Una politica nunca debe re-consultar su propia tabla: durante un
-- `insert ... returning` la fila nueva todavia no es visible para esa consulta,
-- y la insercion falla. event_role() si sirve para las tablas hijas, que
-- consultan `events` y no a si mismas.
create policy events_read on public.events
  for select using (public.user_org_role(org_id) is not null);

create policy events_insert on public.events
  for insert with check (public.user_org_role(org_id) in ('owner', 'admin'));

create policy events_update on public.events
  for update using (public.user_org_role(org_id) in ('owner', 'admin'))
  with check (public.user_org_role(org_id) in ('owner', 'admin'));

create policy events_delete on public.events
  for delete using (public.user_org_role(org_id) = 'owner');

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
--
-- Explicitos a proposito, en vez de apoyarse en los default privileges de
-- Supabase. Lo que una tabla NO otorga es tan parte del diseno como sus
-- politicas: mas adelante, no otorgar update ni delete sobre timing_events es
-- lo que hace que el log sea realmente inmutable.

grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.org_members to authenticated;
grant select, insert, update, delete on public.events to authenticated;

grant execute on function public.user_org_role(uuid) to authenticated;
grant execute on function public.event_role(uuid) to authenticated;
grant execute on function public.can_manage_event(uuid) to authenticated;
grant execute on function public.can_verify_event(uuid) to authenticated;
