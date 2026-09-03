-- La lista de inscritos, publica.
--
-- LA PESTAÑA DE LEADERBOARDS TIENE QUE SERVIR DESDE QUE ABREN LAS INSCRIPCIONES,
-- no solo cuando hay resultados. Entre que un atleta se anota y que la
-- competencia arranca pasan semanas, y en todo ese tiempo la pregunta que se
-- hace es "¿quien mas se inscribio en mi categoria?". Hoy esa pestaña mostraba
-- un vacio durante meses y despues, de golpe, la tabla.
--
-- Es la misma lista de largada que cualquier competencia pega en la pared. Que
-- los nombres de los inscritos sean publicos no es una decision nueva: el
-- leaderboard ya los muestra apenas empieza a correr.
--
-- QUE NO SALE: correo, telefono, fecha de nacimiento, documento ni el estado del
-- pago. Nada de eso le sirve a otro atleta y todo eso es de la persona. Solo
-- nombre, dorsal y categoria.

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

select public.apply_function_lockdown();
