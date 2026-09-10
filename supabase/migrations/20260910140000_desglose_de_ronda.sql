-- Desglose de la ronda en la que un atleta quedo, movimiento por movimiento.
--
-- "3 rondas + 10 reps" es ambiguo: no dice en CUAL de los movimientos de la
-- ronda quedo (¿10 de un Push-up que pide 10, o 10 en un Air Squat que pide
-- 15?) ni si los movimientos anteriores de esa ronda estan completos. Es
-- justo la confusion reportada tanto en la pantalla del juez como en el
-- leaderboard.
--
-- `reduceWodEvents` (src/shared/timing/wod.ts) ya calcula ese desglose en
-- vivo (`WodResult.currentRoundBreakdown`), pero solo vive en el navegador:
-- el leaderboard (panel y publico) lee `workout_scores`, que hasta ahora solo
-- guardaba el total aplanado (value_reps). Esta columna persiste el mismo
-- desglose que ve el juez, para que el leaderboard pueda mostrar el mismo
-- detalle sin recalcular nada -- ver `RawScore.roundBreakdown` en
-- src/shared/scoring/types.ts.

alter table public.workout_scores
  add column round_breakdown jsonb;

comment on column public.workout_scores.round_breakdown is
  'Movimiento por movimiento de la ronda en la que quedo el atleta: '
  '[{name, unit, target, done, completo}, ...]. Null si la prueba no tiene '
  'rondas, si vino de carga manual, o si el bloque cerro entero sin nada a '
  'medias. Lo escribe solo el recalculo (calcularScoresDeWod), igual que el '
  'resto de las columnas de esta tabla.';

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
    -- Se mantiene en 5: agregar `roundBreakdown` a cada score no cambia el
    -- resto de la forma, mismo criterio que tiePointPolicy.
    'version', 5,
    'detalle', p_detalle,
    'event', (
      select jsonb_build_object(
        'name', e.name,
        'venue', e.venue,
        'status', e.status,
        'format', e.format,
        'official', e.status = 'published',
        'tiePointPolicy', e.tie_point_policy
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
        'locked', sn.locked_at is not null,
        'tiePointPolicy', sn.tie_point_policy
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
        'tiebreak', ws.tiebreak_value,
        'roundBreakdown', ws.round_breakdown
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

select public.apply_function_lockdown();
