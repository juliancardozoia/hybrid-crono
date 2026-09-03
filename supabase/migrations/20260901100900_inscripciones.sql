-- Inscripciones.
--
-- Hasta ahora el padron entraba por CSV o a mano: `athletes.external_ref` esta
-- literalmente documentado como "id del sistema de inscripciones DEL
-- ORGANIZADOR". Esta migracion trae ese sistema adentro.
--
-- LA DECISION QUE ORDENA TODO
--
-- Una inscripcion NO es un equipo. Son dos cosas con vidas distintas:
--
--   registrations  el tramite: quien lo empezo, a quien invito, que falta, si
--                  se pago. Puede quedar a medias para siempre.
--   teams          la unidad que compite y rankea. Existe solo si el tramite
--                  llego a buen puerto.
--
-- Confirmar una inscripcion MATERIALIZA el equipo: crea athletes, teams y
-- team_members, y le asigna dorsal. Por eso heats, lanes, results y la PWA del
-- juez no se enteran de que existen las inscripciones — siguen viendo equipos,
-- exactamente como antes.
--
-- El alta manual del organizador entra por el mismo camino, con el tramite ya
-- confirmado. Un solo lugar donde nace un equipo.

-- ---------------------------------------------------------------------------
-- El atleta del evento se enlaza con la cuenta que lo inscribio
-- ---------------------------------------------------------------------------
--
-- `athletes` es y sigue siendo un registro POR EVENTO: el mismo humano en tres
-- competencias son tres filas. Esta columna no cambia eso, solo deja el rastro
-- de que cuenta se inscribio, que es lo que despues permite mostrarle a alguien
-- su historial sin adivinarlo por el nombre.
--
-- Nullable a proposito: el import CSV y el alta manual siguen creando atletas
-- sin cuenta, y esa via no se toca.
alter table public.athletes
  add column profile_id uuid references public.profiles (id) on delete set null;

create index athletes_profile_idx on public.athletes (profile_id)
  where profile_id is not null;

create type public.registration_status as enum (
  'borrador',
  'esperando_integrantes',  -- falta que alguien complete sus datos
  'esperando_pago',
  'confirmada',
  'cancelada',
  'lista_espera'
);

create type public.registration_member_status as enum ('invitado', 'completo');

create type public.registration_field_type as enum (
  'texto', 'numero', 'seleccion', 'booleano', 'fecha'
);

-- ---------------------------------------------------------------------------
-- Que se le pide a cada categoria
-- ---------------------------------------------------------------------------

create table public.division_registration (
  division_id uuid primary key,
  event_id uuid not null,
  -- Sin precio o en cero, la inscripcion se confirma sola: es el caso de una
  -- competencia interna o de una categoria de cortesia.
  price_cents int check (price_cents >= 0),
  currency text not null default 'COP' check (currency ~ '^[A-Z]{3}$'),
  -- Null = sin limite de cupo.
  capacity int check (capacity > 0),
  -- Si se pueden cambiar integrantes despues de que cierran las inscripciones.
  allows_member_swap boolean not null default false,
  -- Ventana propia de la categoria. Null = la del evento.
  opens_at timestamptz,
  closes_at timestamptz,
  constraint division_registration_ventana
    check (opens_at is null or closes_at is null or opens_at <= closes_at),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade
);

create index division_registration_event_idx on public.division_registration (event_id);

-- Los campos extra del formulario. Son DATOS y no columnas porque cada
-- competencia pide cosas distintas: el box, la talla del acompanante, el numero
-- de camiseta, el contacto de emergencia. Agregarle una columna a la tabla por
-- cada idea de cada organizador no escala.
create table public.registration_fields (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Null = se le pide a todas las categorias.
  division_id uuid,
  key text not null check (key ~ '^[a-z0-9_]{2,32}$'),
  label text not null check (length(trim(label)) > 0),
  type public.registration_field_type not null default 'texto',
  required boolean not null default false,
  options text[] not null default '{}',
  -- Si lo responde el equipo una vez, o cada integrante por separado.
  scope text not null default 'integrante' check (scope in ('equipo', 'integrante')),
  order_index int not null default 0 check (order_index >= 0),
  created_at timestamptz not null default now(),
  unique (event_id, key),
  constraint campos_de_seleccion_tienen_opciones
    check (type <> 'seleccion' or array_length(options, 1) >= 1),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade
);

create index registration_fields_event_idx on public.registration_fields (event_id, order_index);

-- ---------------------------------------------------------------------------
-- El tramite
-- ---------------------------------------------------------------------------

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  division_id uuid not null,
  -- Quien lo empezo. Es el capitan: invita, completa y envia.
  created_by uuid not null references auth.users (id) on delete restrict,
  status public.registration_status not null default 'borrador',
  team_name text,
  -- Respuestas de los campos con scope 'equipo'.
  answers jsonb not null default '{}'::jsonb,
  -- Precio congelado al momento de inscribirse: si el organizador lo sube
  -- despues, quien ya se anoto paga lo que le dijeron.
  price_cents int check (price_cents >= 0),
  currency text,
  -- El equipo que se materializo al confirmar. Null mientras el tramite no
  -- llego a buen puerto.
  team_id uuid,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, event_id),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete restrict,
  -- SET NULL acotado: una FK compuesta con SET NULL a secas anula tambien
  -- event_id, que es NOT NULL.
  foreign key (team_id, event_id)
    references public.teams (id, event_id) on delete set null (team_id)
);

create index registrations_event_idx on public.registrations (event_id, status);
create index registrations_division_idx on public.registrations (division_id, status);
create index registrations_creador_idx on public.registrations (created_by);
create unique index registrations_team_once on public.registrations (team_id)
  where team_id is not null;

create trigger registrations_touch_updated_at
  before update on public.registrations
  for each row execute function public.touch_updated_at();

create table public.registration_members (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null,
  event_id uuid not null,
  position int not null check (position >= 1),
  -- Se llena cuando la persona entra con su cuenta y reclama la invitacion.
  profile_id uuid references public.profiles (id) on delete set null,
  -- El correo real que puso el capitan. Es la llave de la invitacion.
  invited_email text not null check (position('@' in invited_email) > 1),
  status public.registration_member_status not null default 'invitado',
  first_name text,
  last_name text,
  birth_date date,
  gender public.athlete_gender,
  phone text,
  shirt_size text,
  answers jsonb not null default '{}'::jsonb,
  accepted_terms_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registration_id, position),
  unique (id, event_id),
  foreign key (registration_id, event_id)
    references public.registrations (id, event_id) on delete cascade,
  -- Un integrante "completo" tiene lo minimo para ser un atleta.
  constraint integrante_completo_tiene_datos check (
    status <> 'completo'
    or (
      first_name is not null and length(trim(first_name)) > 0
      and last_name is not null and length(trim(last_name)) > 0
      and accepted_terms_at is not null
    )
  )
);

-- Un mismo correo no puede ocupar dos lugares del mismo equipo.
create unique index registration_members_email_unico
  on public.registration_members (registration_id, lower(invited_email));

create index registration_members_perfil_idx on public.registration_members (profile_id);
create index registration_members_email_idx
  on public.registration_members (lower(invited_email)) where profile_id is null;

create trigger registration_members_touch_updated_at
  before update on public.registration_members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers de visibilidad
-- ---------------------------------------------------------------------------
--
-- Son SECURITY DEFINER por la misma razon que event_role: las politicas de
-- registrations preguntan por registration_members y las de registration_members
-- preguntan por registrations. Sin definer eso es recursion mutua de RLS.

create or replace function public.es_integrante_de(p_registration_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.registration_members m
    where m.registration_id = p_registration_id and m.profile_id = auth.uid()
  );
$$;

create or replace function public.evento_de_inscripcion(p_registration_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.event_id from public.registrations r where r.id = p_registration_id;
$$;

create or replace function public.puede_ver_inscripcion(p_registration_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    exists (
      select 1 from public.registrations r
      where r.id = p_registration_id
        and (
          r.created_by = auth.uid()
          or public.event_role(r.event_id) is not null
        )
    )
    or public.es_integrante_de(p_registration_id),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.division_registration enable row level security;
alter table public.registration_fields enable row level security;
alter table public.registrations enable row level security;
alter table public.registration_members enable row level security;

-- La configuracion del formulario la lee cualquier usuario logueado: la
-- necesita el atleta que se esta inscribiendo, que no es miembro del evento.
-- No expone nada sensible — es el formulario en blanco.
create policy division_registration_read on public.division_registration
  for select using (auth.uid() is not null);
create policy division_registration_write on public.division_registration
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy registration_fields_read on public.registration_fields
  for select using (auth.uid() is not null);
create policy registration_fields_write on public.registration_fields
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- El tramite lo ve quien lo empezo, quien fue invitado, y la organizacion.
-- La ESCRITURA no tiene politica a proposito: no hay GRANT de insert ni update,
-- asi que todo pasa por las funciones de abajo. Misma jugada que workout_scores
-- y timing_events.
create policy registrations_read on public.registrations
  for select using (
    created_by = auth.uid()
    or public.event_role(event_id) is not null
    or public.es_integrante_de(id)
  );

create policy registration_members_read on public.registration_members
  for select using (public.puede_ver_inscripcion(registration_id));

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

revoke all on public.division_registration from anon, authenticated;
revoke all on public.registration_fields from anon, authenticated;
revoke all on public.registrations from anon, authenticated;
revoke all on public.registration_members from anon, authenticated;

grant select, insert, update, delete on public.division_registration to authenticated;
grant select, insert, update, delete on public.registration_fields to authenticated;
grant select on public.registrations to authenticated;
grant select on public.registration_members to authenticated;

select public.apply_function_lockdown();
