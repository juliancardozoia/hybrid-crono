-- La tabla general mostraba el dorsal junto al nombre del equipo. El pedido
-- fue reemplazarlo por la bandera del pais de cada atleta -- lo mismo que ya
-- hace `GrillaDeAtletas` en /atletas -- pero `scoreboard_document()` nunca
-- devolvia el pais: solo el nombre concatenado ("Juan Perez / Ana Diaz").
--
-- Se agrega `countries`, un arreglo con el `country` de cada integrante del
-- equipo, EN EL MISMO ORDEN que ya usa `athletes` (por apellido) para que la
-- bandera de la posicion N corresponda al nombre de la posicion N. No se
-- reemplaza `athletes` por una estructura mas rica (nombre+pais por fila)
-- para no romper a quien ya lee ese campo como string.
--
-- No hace falta `apply_function_lockdown()`: es un `create or replace` sobre
-- una funcion que ya existe con el mismo nombre y aridad, asi que conserva los
-- privilegios que ya tiene (Postgres no resetea el EXECUTE al reemplazar).

create or replace function public.scoreboard_document(
  p_event_id uuid,
  p_detalle boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.event_status;
  v_plan public.org_plan;
begin
  select e.status, o.plan
  into v_status, v_plan
  from public.events e
  join public.organizations o on o.id = e.org_id
  where e.id = p_event_id;

  if v_status is null then
    return null;
  end if;

  if not (
    public.puede_leer_evento(p_event_id)
    or (v_plan = 'pro' and v_status in ('live', 'verifying', 'published'))
    or (v_plan = 'free' and v_status = 'published')
  ) then
    return null;
  end if;

  return jsonb_build_object(
    -- Se mantiene en 5: agregar `countries` no cambia el resto de la forma.
    'version', 5,
    'detalle', p_detalle,
    'event', (
      select jsonb_build_object(
        'name', e.name,
        'venue', e.venue,
        'status', e.status,
        'format', e.format,
        'official', e.status = 'published'
      )
      from public.events e where e.id = p_event_id
    ),
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
      from public.divisions d
      where d.event_id = p_event_id
    ), '[]'::jsonb),
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'divisionId', sn.division_id,
        'stage', sn.stage,
        'points', sn.points,
        'locked', sn.locked_at is not null
      ))
      from public.scoring_snapshots sn
      join public.divisions d on d.id = sn.division_id
      where d.event_id = p_event_id
    ), '[]'::jsonb),
    'stageAdvancements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'divisionId', sa.division_id,
        'stage', sa.stage,
        'teamId', sa.team_id
      ))
      from public.stage_advancements sa
      where sa.event_id = p_event_id
    ), '[]'::jsonb),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'workoutId', w.id,
        'workoutName', w.name,
        'label', p.label,
        'orderIndex', w.order_index * 1000 + p.order_index,
        'stage', w.stage,
        'timeScheme', p.time_scheme,
        'scoreUnit', p.score_unit,
        'scoreDir', p.score_dir,
        'capUnit', p.cap_unit,
        'maxPoints', p.max_points,
        'tiebreakUnit', p.tiebreak_unit,
        'tiebreakDir', p.tiebreak_dir,
        'tiebreakPartId', case when p.tiebreak_source = 'otra_prueba' then p.tiebreak_part_id end
      ) order by w.order_index, p.order_index)
      from public.workout_parts p
      join public.workouts w on w.id = p.workout_id
      where p.event_id = p_event_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'partId', pd.part_id,
        'divisionId', pd.division_id
      ))
      from public.part_divisions pd
      where pd.event_id = p_event_id
    ), '[]'::jsonb),
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
        ),
        -- En el mismo orden que `athletes` (por apellido): la bandera N
        -- corresponde al nombre N.
        'countries', coalesce((
          select jsonb_agg(a.country order by a.last_name)
          from public.team_members tm
          join public.athletes a on a.id = tm.athlete_id
          where tm.team_id = t.id
        ), '[]'::jsonb)
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
end;
$$;
