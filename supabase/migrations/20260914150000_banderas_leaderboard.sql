-- El leaderboard en vivo (LeaderboardLive.tsx) mostraba el nombre del atleta
-- o equipo sin bandera -- la tabla general (`scoreboard_document`, ver
-- 20260909220000_scoreboard_document_paises.sql) ya la muestra hace rato, y
-- son la misma pregunta ("¿como va?") en dos lugares de la misma pestaña.
--
-- `countries` va en el MISMO ORDEN que `athletes` (por apellido, igual que
-- scoreboard_document), para que la bandera de la posicion N corresponda al
-- nombre de la posicion N.
--
-- SI hace falta `drop function` primero: agregar una columna a un `returns
-- table` cambia el tipo de fila que la funcion devuelve, y Postgres no deja
-- reemplazar una funcion cambiandole el tipo de retorno (`cannot change
-- return type of existing function`, SQLSTATE 42P13) aunque la aridad de
-- ENTRADA no haya cambiado. Distinto del caso de `admin_create_registration`
-- (agregar un PARAMETRO), pero misma leccion: create or replace no alcanza,
-- hace falta dropear la firma vieja primero. Como la aridad de entrada es la
-- misma (`text`), alcanza con nombrar esa firma exacta.
drop function if exists public.public_leaderboard(text);

create function public.public_leaderboard(p_public_slug text)
returns table (
  division_name text,
  bib_number int,
  team_name text,
  athletes text,
  countries jsonb,
  status public.lane_status,
  total_ms int,
  penalty_ms int,
  splits jsonb,
  rank_position bigint,
  official boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    d.name as division_name,
    t.bib_number,
    t.name as team_name,
    (
      select string_agg(a.first_name || ' ' || a.last_name, ' / ' order by a.last_name)
      from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
    ) as athletes,
    coalesce((
      select jsonb_agg(a.country order by a.last_name)
      from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
    ), '[]'::jsonb) as countries,
    r.status,
    r.total_ms,
    r.penalty_ms,
    r.splits,
    rank() over (
      partition by r.division_id
      order by
        case r.status when 'finished' then 0 when 'running' then 1 else 2 end,
        r.total_ms nulls last
    ) as rank_position,
    (e.status = 'published') as official
  from public.events e
  join public.results r on r.event_id = e.id
  join public.teams t on t.id = r.team_id
  join public.divisions d on d.id = r.division_id
  where e.public_slug = p_public_slug
    -- Un evento en borrador o listo todavia no muestra nada al publico.
    and e.status in ('live', 'verifying', 'published');
$$;

-- El drop de arriba se llevo los GRANT explicitos que tenia la funcion vieja
-- (anon + authenticated, ver 20260822100900_lockdown_functions.sql). Como
-- ademas Postgres vuelve a otorgar EXECUTE a PUBLIC en cada `create`, hace
-- falta reaplicar la politica completa: revoca de PUBLIC y le devuelve el
-- acceso correcto segun el nombre (`public_*` -> anon y authenticated).
select public.apply_function_lockdown();
