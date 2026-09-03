-- El catalogo publico de competencias.
--
-- Es la primera superficie del producto que le habla a un atleta y no a un
-- organizador, y la primera que se sirve a gente sin cuenta. Vale la pena
-- repetir la regla que la gobierna: **el rol `anon` no tiene GRANT sobre
-- ninguna tabla**. Todo lo que ve el publico sale de funciones `public_*` que
-- son SECURITY DEFINER y devuelven exactamente lo que hace falta.
--
-- Que un evento aparezca en el catalogo depende de `published_at`, no de
-- `status`. Son dos cosas distintas y conviene no confundirlas:
--
--   status       en que momento de su vida esta la competencia (borrador,
--                lista, en vivo, verificando, publicada).
--   published_at si el organizador decidio mostrarla al mundo.
--
-- Una competencia interna corre entera —se configura, se cronometra, se
-- verifica— sin aparecer nunca en el catalogo.

-- Cuando se hace publico el WOD.
--
-- Un organizador carga las pruebas semanas antes para poder configurar la
-- pantalla del juez, y casi nunca quiere que los atletas las vean con esa
-- anticipacion. Sin esta columna, publicar la competencia publicaria tambien
-- los WODs, y el organizador tendria que elegir entre configurar tarde o
-- revelar temprano.
alter table public.workouts add column released_at timestamptz;

-- ---------------------------------------------------------------------------
-- Publicar y despublicar
-- ---------------------------------------------------------------------------

create or replace function public.publish_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evento public.events;
begin
  if not coalesce(public.can_manage_event(p_event_id), false) then
    raise exception 'Solo la organización puede publicar una competencia'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_evento from public.events where id = p_event_id;

  -- Una competencia sin nombre, sin fecha o sin categorias en el catalogo es
  -- peor que no estar: el atleta la abre y no puede hacer nada.
  if v_evento.starts_at is null then
    raise exception 'Falta la fecha de la competencia';
  end if;

  if not exists (select 1 from public.divisions where event_id = p_event_id) then
    raise exception 'Falta crear al menos una categoría';
  end if;

  update public.events
  set published_at = coalesce(published_at, now())
  where id = p_event_id
  returning * into v_evento;

  return v_evento;
end;
$$;

create or replace function public.unpublish_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_evento public.events;
begin
  if not coalesce(public.can_manage_event(p_event_id), false) then
    raise exception 'Solo la organización puede despublicar una competencia'
      using errcode = 'insufficient_privilege';
  end if;

  update public.events set published_at = null where id = p_event_id
  returning * into v_evento;

  return v_evento;
end;
$$;

-- ---------------------------------------------------------------------------
-- El catalogo
-- ---------------------------------------------------------------------------

create or replace function public.public_events_catalog(
  p_busqueda text default null,
  p_pais text default null,
  p_formato public.event_format default null,
  p_desde date default null,
  p_hasta date default null,
  p_destacados boolean default false,
  -- Para "vistos recientemente": el navegador guarda los slugs y los manda.
  p_slugs text[] default null,
  p_limite int default 24,
  p_offset int default 0
)
returns table (
  public_slug text,
  name text,
  description text,
  logo_url text,
  cover_url text,
  format public.event_format,
  event_type public.event_type,
  country text,
  state text,
  city text,
  venue text,
  starts_at timestamptz,
  ends_at timestamptz,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  timezone text,
  organizer_name text,
  destacado boolean,
  inscripciones_abiertas boolean,
  -- El total de la busqueda viaja en cada fila para poder paginar sin una
  -- segunda consulta que tendria que repetir todos los filtros.
  total bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.public_slug,
    e.name,
    e.description,
    e.logo_url,
    e.cover_url,
    e.format,
    e.event_type,
    e.country,
    e.state,
    e.city,
    e.venue,
    e.starts_at,
    e.ends_at,
    e.registration_opens_at,
    e.registration_closes_at,
    e.timezone,
    e.organizer_name,
    (e.featured_at is not null) as destacado,
    (
      (e.registration_opens_at is null or e.registration_opens_at <= now())
      and (e.registration_closes_at is null or e.registration_closes_at > now())
    ) as inscripciones_abiertas,
    count(*) over () as total
  from public.events e
  where e.published_at is not null
    and (p_pais is null or e.country = p_pais)
    and (p_formato is null or e.format = p_formato)
    and (p_desde is null or e.starts_at >= p_desde::timestamptz)
    and (p_hasta is null or e.starts_at < (p_hasta + 1)::timestamptz)
    and (not p_destacados or e.featured_at is not null)
    and (p_slugs is null or e.public_slug = any (p_slugs))
    and (
      p_busqueda is null
      or p_busqueda = ''
      -- Busqueda simple sobre lo que alguien escribiria: el nombre de la
      -- competencia, la ciudad o la sede.
      or e.name ilike '%' || p_busqueda || '%'
      or coalesce(e.city, '') ilike '%' || p_busqueda || '%'
      or coalesce(e.venue, '') ilike '%' || p_busqueda || '%'
      or coalesce(e.organizer_name, '') ilike '%' || p_busqueda || '%'
    )
  -- Los destacados primero, y despues por fecha: lo que viene pronto arriba.
  order by (e.featured_at is not null) desc, e.starts_at asc nulls last, e.name asc
  limit greatest(1, least(coalesce(p_limite, 24), 60))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- Los paises y los meses que tienen competencias publicadas, para que los
-- filtros ofrezcan solo lo que existe en vez de una lista de doce paises vacios.
create or replace function public.public_catalog_filters()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'paises', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', t.country, 'cantidad', t.n) order by t.n desc)
      from (
        select country, count(*)::int as n
        from public.events
        where published_at is not null and country is not null
        group by country
      ) t
    ), '[]'::jsonb),
    'meses', coalesce((
      select jsonb_agg(jsonb_build_object('mes', t.mes, 'cantidad', t.n) order by t.mes)
      from (
        select to_char(starts_at, 'YYYY-MM') as mes, count(*)::int as n
        from public.events
        where published_at is not null and starts_at is not null and starts_at >= now() - interval '1 month'
        group by 1
      ) t
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- La ficha publica de una competencia
-- ---------------------------------------------------------------------------

create or replace function public.public_event_detail(p_public_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'slug', e.public_slug,
    'name', e.name,
    'description', e.description,
    'logoUrl', e.logo_url,
    'coverUrl', e.cover_url,
    'format', e.format,
    'eventType', e.event_type,
    'status', e.status,
    'country', e.country,
    'state', e.state,
    'city', e.city,
    'venue', e.venue,
    'address', e.address,
    'startsAt', e.starts_at,
    'endsAt', e.ends_at,
    'registrationOpensAt', e.registration_opens_at,
    'registrationClosesAt', e.registration_closes_at,
    'timezone', e.timezone,
    'organizerName', e.organizer_name,
    'instagram', e.instagram,
    'website', e.website,
    'shirtSizes', e.shirt_sizes,
    'inscripcionesAbiertas', (
      (e.registration_opens_at is null or e.registration_opens_at <= now())
      and (e.registration_closes_at is null or e.registration_closes_at > now())
    ),
    'resultadosVisibles', e.status in ('live', 'verifying', 'published'),
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', d.name,
        'teamSize', d.team_size,
        'genderRule', d.gender_rule,
        'ageMin', d.age_min,
        'ageMax', d.age_max,
        'level', d.level
      ) order by d.name)
      from public.divisions d where d.event_id = e.id
    ), '[]'::jsonb),
    -- Las pruebas se listan siempre; su CONTENIDO solo si el organizador ya lo
    -- libero. Un WOD cargado con semanas de anticipacion para configurar al
    -- juez no tiene por que ser publico desde ese momento.
    'workouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', w.name,
        'liberado', (w.released_at is not null and w.released_at <= now()),
        'description', case when w.released_at is not null and w.released_at <= now()
                            then w.description else null end,
        'parts', case when w.released_at is not null and w.released_at <= now() then (
          select coalesce(jsonb_agg(jsonb_build_object(
            'label', p.label,
            'timeScheme', p.time_scheme,
            'scoreUnit', p.score_unit,
            'timeCapMs', p.time_cap_ms,
            'windowMs', p.window_ms,
            'intervalMs', p.interval_ms
          ) order by p.order_index), '[]'::jsonb)
          from public.workout_parts p where p.workout_id = w.id
        ) else '[]'::jsonb end
      ) order by w.order_index)
      from public.workouts w where w.event_id = e.id
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('name', doc.name, 'url', doc.url) order by doc.order_index)
      from public.event_documents doc where doc.event_id = e.id
    ), '[]'::jsonb),
    -- El cronograma: solo horas y nombres, sin dorsales ni jueces.
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', h.name,
        'scheduledAt', h.scheduled_at,
        'workout', (select w2.name from public.workouts w2 where w2.id = h.workout_id)
      ) order by h.scheduled_at nulls last, h.name)
      from public.heats h where h.event_id = e.id and h.scheduled_at is not null
    ), '[]'::jsonb)
  )
  from public.events e
  where e.public_slug = p_public_slug and e.published_at is not null;
$$;

select public.apply_function_lockdown();
