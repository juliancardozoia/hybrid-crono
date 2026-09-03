-- El documento del scoreboard: la unica lectura que alimenta el leaderboard.
--
-- POR QUE ESTA FUNCION NO RANKEA
--
-- Proyecta filas crudas y nada mas: ni posiciones, ni puntos, ni desempates.
-- Todo eso lo calcula src/shared/scoring/ en TypeScript, igual que todo el
-- tiempo lo calcula src/shared/timing/. La razon es la misma que ya gobierna el
-- cronometro: si el numero en vivo y el oficial pudieran salir de dos
-- implementaciones distintas, el producto pierde sentido.
--
-- Y hay una razon tecnica ademas de la doctrinaria: con N pruebas y desempate
-- por vector de puestos, un rank() de SQL no puede reproducir el orden. El
-- reglamento de los Games desempata comparando los puestos de cada atleta
-- ordenados de mejor a peor, elemento por elemento. Eso no es una window
-- function.
--
-- Devuelve jsonb y no `returns table` a proposito: el documento es normalizado
-- (los nombres de los atletas aparecen una vez, no repetidos por prueba), lleva
-- version, y de paso esquiva que `position` sea palabra reservada en la lista
-- de columnas de un returns table.

create or replace function public.scoreboard_document(
  p_event_id uuid,
  p_detalle boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'version', 2,
    'detalle', p_detalle,
    'event', (
      select jsonb_build_object(
        'name', e.name,
        'venue', e.venue,
        'status', e.status,
        'official', e.status = 'published'
      )
      from public.events e where e.id = p_event_id
    ),
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'scoringTable', coalesce(st.builtin_key, st.id::text, 'tiempo_total'),
        'customPoints', coalesce(st.points, '{}')
      ) order by d.name)
      from public.divisions d
      left join public.scoring_tables st on st.id = d.scoring_table_id
      where d.event_id = p_event_id
    ), '[]'::jsonb),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'workoutId', w.id,
        'workoutName', w.name,
        'label', p.label,
        'orderIndex', w.order_index * 1000 + p.order_index,
        'timeScheme', p.time_scheme,
        'scoreUnit', p.score_unit,
        'scoreDir', p.score_dir,
        'capUnit', p.cap_unit,
        'tiebreakUnit', p.tiebreak_unit,
        'tiebreakDir', p.tiebreak_dir
      ) order by w.order_index, p.order_index)
      from public.workout_parts p
      join public.workouts w on w.id = p.workout_id
      where p.event_id = p_event_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object('partId', pd.part_id, 'divisionId', pd.division_id))
      from public.part_divisions pd
      where pd.event_id = p_event_id
    ), '[]'::jsonb),
    -- Los retirados NO entran al padron. Con posiciones fisicas, un equipo
    -- retirado que aparece al fondo le corre la posicion a todos los que estan
    -- detras y les cambia los puntos. Hay que decidirlo antes de competir, no
    -- despues de anunciar el podio.
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'divisionId', t.division_id,
        'bib', t.bib_number,
        'name', t.name,
        'athletes', (
          select string_agg(a.first_name || ' ' || a.last_name, ' / ' order by a.last_name)
          from public.team_members tm
          join public.athletes a on a.id = tm.athlete_id
          where tm.team_id = t.id
        )
      ) order by t.bib_number)
      from public.teams t
      where t.event_id = p_event_id and t.status <> 'withdrawn'
    ), '[]'::jsonb),
    'scores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'partId', ws.part_id,
        'teamId', ws.team_id,
        'status', ws.status,
        'value', ws.value_num,
        'reps', ws.value_reps,
        'capValue', ws.value_cap,
        'tiebreak', ws.tiebreak_value
      ))
      from public.workout_scores ws
      join public.teams t on t.id = ws.team_id
      where ws.event_id = p_event_id and t.status <> 'withdrawn'
    ), '[]'::jsonb),
    -- Los parciales solo viajan cuando el evento los muestra. En el plan
    -- gratuito el atleta ve su tiempo final y nada mas.
    'splits', case when p_detalle then coalesce((
      select jsonb_agg(jsonb_build_object(
        'teamId', r.team_id,
        'partId', p.id,
        'splits', r.splits,
        'penaltyMs', r.penalty_ms
      ))
      from public.results r
      join public.lanes l on l.id = r.lane_id
      join public.workout_parts p on p.workout_id = l.workout_id and p.order_index = 0
      where r.event_id = p_event_id and r.team_id is not null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

-- La unica puerta del publico al leaderboard general.
--
-- ACA VIVE EL GATE DEL PLAN, y no en el componente de React: si estuviera en la
-- UI se saltearia leyendo la respuesta de la red.
--
--   plan pro  -> leaderboard en vivo desde que arranca el evento, con parciales.
--   plan free -> nada hasta que el evento se publica, y sin parciales.
--
-- Es exactamente la diferencia que se compra: no se restringe cronometrar, se
-- restringe exhibir.
create or replace function public.public_scoreboard(p_public_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_status public.event_status;
  v_plan public.org_plan;
begin
  select e.id, e.status, o.plan
  into v_event_id, v_status, v_plan
  from public.events e
  join public.organizations o on o.id = e.org_id
  where e.public_slug = p_public_slug;

  if v_event_id is null then
    return null;
  end if;

  if v_plan = 'pro' then
    if v_status not in ('live', 'verifying', 'published') then
      return null;
    end if;
    return public.scoreboard_document(v_event_id, true);
  end if;

  -- Plan gratuito: recien cuando el evento cerro, y sin detalle.
  if v_status <> 'published' then
    return null;
  end if;
  return public.scoreboard_document(v_event_id, false);
end;
$$;

select public.apply_function_lockdown();
