-- La lista de largada (pestaña Leaderboards, antes de que haya resultados)
-- no mostraba el pais de cada integrante -- la tabla general ya lo hace
-- (`scoreboard_document`, ver 20260909220000_scoreboard_document_paises.sql)
-- y es la MISMA grilla documentada en ListaDeLargada.tsx ("POS · ATLETA/EQUIPO
-- · PTS, la misma tabla antes de tener con que llenarla"): si una muestra la
-- bandera, la otra tiene que mostrarla tambien.
--
-- `countries` va en el MISMO ORDEN que `integrantes` (por first_name), para
-- que la bandera de la posicion N corresponda al nombre de la posicion N.
--
-- No hace falta `apply_function_lockdown()`: es un `create or replace` sobre
-- una funcion que ya existe con el mismo nombre y aridad, asi que conserva
-- los privilegios que ya tiene.

create or replace function public.public_participants(p_public_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'evento', e.name,
    'divisiones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nombre', d.name,
        'equipos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'dorsal', t.bib_number,
            -- En individuales el equipo no tiene nombre y se muestra el del
            -- atleta, que es como lo anuncia el speaker.
            'nombre', coalesce(
              nullif(trim(t.name), ''),
              (
                select string_agg(a.first_name || ' ' || a.last_name, ' / ' order by a.first_name)
                from public.team_members tm
                join public.athletes a on a.id = tm.athlete_id
                where tm.team_id = t.id
              ),
              'Dorsal ' || t.bib_number
            ),
            -- Los integrantes van aparte del nombre: en una dupla el nombre es
            -- el del equipo y aun asi hay que saber quienes lo forman.
            'integrantes', coalesce((
              select jsonb_agg(a.first_name || ' ' || a.last_name order by a.first_name)
              from public.team_members tm
              join public.athletes a on a.id = tm.athlete_id
              where tm.team_id = t.id
            ), '[]'::jsonb),
            'countries', coalesce((
              select jsonb_agg(a.country order by a.first_name)
              from public.team_members tm
              join public.athletes a on a.id = tm.athlete_id
              where tm.team_id = t.id
            ), '[]'::jsonb)
          ) order by t.bib_number)
          from public.teams t
          -- Un equipo retirado no aparece en la lista de largada.
          where t.division_id = d.id and t.status <> 'withdrawn'
        ), '[]'::jsonb)
      ) order by d.name)
      from public.divisions d where d.event_id = e.id
    ), '[]'::jsonb)
  )
  from public.events e
  where e.public_slug = p_public_slug and e.published_at is not null;
$$;
