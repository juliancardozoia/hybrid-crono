-- Los filtros del catalogo: pais, ciudad, mes, año y formato.
--
-- Antes se filtraba por pais y por un rango de fechas que la pantalla armaba a
-- partir de un "2026-03". Eso obliga a elegir mes Y año juntos, y es justo lo
-- que un atleta no hace: busca "marzo" para ver que hay, o "2027" para
-- planificar la temporada. Mes y año son dos preguntas distintas.
--
-- MES Y AÑO SALEN DE `event_date`, NO DE `starts_at`
--
-- `event_date` la deriva un trigger desde `starts_at` EN EL HUSO DEL EVENTO. Un
-- `extract(month from starts_at)` a secas lee el timestamp en UTC, y una
-- largada a las 20:55 del 31 de marzo en Bogota cae en abril. La competencia
-- aparecia en el mes equivocado, que es exactamente el bug que la columna
-- derivada existe para evitar.

-- La firma cambia (tres parametros nuevos), asi que hay que borrarla: un
-- `create or replace` con otra lista de argumentos crea una SOBRECARGA, y
-- PostgREST no sabria cual de las dos invocar.
drop function if exists public.public_events_catalog(
  text, text, public.event_format, date, date, boolean, text[], int, int
);

create or replace function public.public_events_catalog(
  p_busqueda text default null,
  p_pais text default null,
  p_formato public.event_format default null,
  p_desde date default null,
  p_hasta date default null,
  p_destacados boolean default false,
  p_slugs text[] default null,
  p_limite int default 24,
  p_offset int default 0,
  p_ciudad text default null,
  p_mes int default null,
  p_anio int default null
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
    -- La ciudad se compara sin distinguir mayusculas ni espacios de sobra: la
    -- escribe a mano cada organizador y "Medellin " no deberia ser otra ciudad.
    and (p_ciudad is null or lower(trim(coalesce(e.city, ''))) = lower(trim(p_ciudad)))
    and (p_formato is null or e.format = p_formato)
    and (p_mes is null or extract(month from e.event_date) = p_mes)
    and (p_anio is null or extract(year from e.event_date) = p_anio)
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

-- Lo que EXISTE para filtrar.
--
-- Ofrecer los veintidos paises de la lista cuando hay competencias en dos es
-- prometer resultados que no estan. Vale igual para ciudades y años.
--
-- El mes es la excepcion y la pantalla los pinta los doce: es un vocabulario
-- cerrado que todo el mundo conoce de memoria, y un selector al que le faltan
-- ocho meses se lee como un error de la pagina, no como "no hay nada en julio".
-- Igual viaja el conteo, para poder mostrar cuantas hay en cada uno.
--
-- La ciudad viaja CON SU PAIS para que la pantalla pueda encadenar los dos
-- selectores sin una segunda consulta: elegir Colombia deja solo las ciudades
-- colombianas.
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
    'ciudades', coalesce((
      select jsonb_agg(
        jsonb_build_object('nombre', t.ciudad, 'pais', t.country, 'cantidad', t.n)
        order by t.ciudad
      )
      from (
        select trim(city) as ciudad, country, count(*)::int as n
        from public.events
        where published_at is not null and coalesce(trim(city), '') <> ''
        group by 1, 2
      ) t
    ), '[]'::jsonb),
    'meses', coalesce((
      select jsonb_agg(jsonb_build_object('mes', t.mes, 'cantidad', t.n) order by t.mes)
      from (
        select extract(month from event_date)::int as mes, count(*)::int as n
        from public.events
        where published_at is not null and event_date is not null
        group by 1
      ) t
    ), '[]'::jsonb),
    'anios', coalesce((
      select jsonb_agg(jsonb_build_object('anio', t.anio, 'cantidad', t.n) order by t.anio)
      from (
        select extract(year from event_date)::int as anio, count(*)::int as n
        from public.events
        where published_at is not null and event_date is not null
        group by 1
      ) t
    ), '[]'::jsonb)
  );
$$;

select public.apply_function_lockdown();
