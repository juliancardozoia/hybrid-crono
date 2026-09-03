-- El evento deja de ser cuatro campos y pasa a ser una ficha de competencia.
--
-- Hasta ahora `events` tenia diez columnas y ninguna servia para publicar nada:
-- ni descripcion, ni logo, ni ubicacion mas alla de un texto libre, ni ventana
-- de inscripcion. Alcanzaba mientras el evento se configuraba a mano y el
-- padron entraba por CSV; no alcanza para un catalogo publico donde alguien
-- busca por pais y por mes.

create type public.event_type as enum ('presencial', 'virtual');

create type public.event_format as enum (
  'crossfit',         -- N pruebas con tabla de puntos
  'carrera_hibrida',  -- circuito cronometrado tipo Hyrox
  'mixto'             -- las dos cosas en el mismo evento
);

alter table public.events
  add column event_type public.event_type not null default 'presencial',
  add column format public.event_format not null default 'carrera_hibrida',
  add column description text,
  add column logo_url text,
  add column cover_url text,
  add column organizer_name text,
  -- Separado del numero porque la plataforma apunta a toda Latinoamerica: sin
  -- el prefijo, un telefono colombiano y uno argentino se ven igual y ninguno
  -- se puede marcar.
  add column organizer_phone_country text,
  add column organizer_phone text,
  add column instagram text,
  add column website text,
  -- Codigo ISO de dos letras. El catalogo publico filtra por aca.
  add column country text check (country is null or country ~ '^[A-Z]{2}$'),
  add column state text,
  add column city text,
  add column address text,
  -- Reemplazan a event_date, que queda derivada (ver el trigger de abajo).
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column registration_opens_at timestamptz,
  add column registration_closes_at timestamptz,
  -- Vacio = el evento no entrega remera y no le pide la talla a nadie.
  add column shirt_sizes text[] not null default '{}',
  add column auto_tiebreak boolean not null default true,
  add column published_at timestamptz,
  add column featured_at timestamptz;

alter table public.events
  add constraint events_fechas_coherentes
    check (starts_at is null or ends_at is null or starts_at <= ends_at),
  add constraint events_inscripcion_coherente
    check (
      registration_opens_at is null
      or registration_closes_at is null
      or registration_opens_at <= registration_closes_at
    );

create index events_catalogo_idx on public.events (country, starts_at)
  where published_at is not null;

-- ---------------------------------------------------------------------------
-- event_date pasa a derivarse
-- ---------------------------------------------------------------------------
--
-- La columna se conserva porque la leen el panel y public_event_info, pero deja
-- de cargarse a mano: se calcula desde starts_at EN EL HUSO DEL EVENTO.
--
-- Ese detalle no es cosmetico. Una largada a las 20:55 en Bogota es el dia
-- siguiente en UTC, asi que calcularla sin el huso mostraria la competencia un
-- dia corrido en el catalogo. Es el mismo error que ya mordio una vez en la
-- torre de control.

create or replace function public.derivar_fecha_del_evento()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.starts_at is not null then
    new.event_date := (new.starts_at at time zone coalesce(new.timezone, 'America/Bogota'))::date;
  end if;
  return new;
end;
$$;

create trigger events_derivar_fecha
  before insert or update of starts_at, timezone on public.events
  for each row execute function public.derivar_fecha_del_evento();

-- Los eventos que ya existian tienen event_date y no starts_at. Se rellena al
-- mediodia del huso para no correr de dia por redondeo en ninguna direccion.
update public.events
set starts_at = (event_date::text || ' 12:00')::timestamp at time zone coalesce(timezone, 'America/Bogota')
where starts_at is null and event_date is not null;

-- ---------------------------------------------------------------------------
-- Documentos del evento
-- ---------------------------------------------------------------------------

create type public.event_document_kind as enum (
  'terminos',
  'reglamento',
  'waiver',
  'otro'
);

create table public.event_documents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.event_document_kind not null default 'otro',
  name text not null check (length(trim(name)) > 0),
  url text not null check (length(trim(url)) > 0),
  -- Si hay que aceptarlo para poder inscribirse.
  requires_acceptance boolean not null default false,
  order_index int not null default 0 check (order_index >= 0),
  created_at timestamptz not null default now(),
  unique (id, event_id)
);

create index event_documents_event_idx on public.event_documents (event_id, order_index);

alter table public.event_documents enable row level security;

create policy event_documents_read on public.event_documents
  for select using (public.event_role(event_id) is not null);
create policy event_documents_write on public.event_documents
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

revoke all on public.event_documents from anon, authenticated;
grant select, insert, update, delete on public.event_documents to authenticated;

select public.apply_function_lockdown();
