-- Como reparten puntos los EMPATES: dos convenciones legitimas, y el default
-- es el reglamento oficial de CrossFit.
--
-- Hoy cada empatado cobra integros los puntos de la posicion compartida (el
-- puesto consumido, por ejemplo el 4 de un empate en el 3, no lo paga nadie).
-- Es exactamente lo que dice el rulebook de los Games: "more than one athlete
-- can share a workout rank, and each will earn the original point value".
--
-- La convencion Scora es distinta: el grupo reparte equitativamente los
-- puntos de TODAS las posiciones que ocupa, para que el total repartido nunca
-- exceda lo que ofrece la curva. Las dos conviven, elegidas explicitamente por
-- competencia -- ver `TiePointPolicy` en src/shared/scoring/types.ts.
--
-- POR QUE NO HACE FALTA EL DOBLE ALTER. El default elegido
-- (`same_position_points`) es EXACTAMENTE el comportamiento que el codigo ya
-- tenia: las filas existentes y las nuevas reciben el mismo valor, asi que un
-- solo `not null default` alcanza. Si el dia de mañana el default cambiara a
-- algo distinto de lo vigente, hacen falta DOS pasos -- `add column ...
-- default <vigente>` primero, `alter column ... set default <nuevo>` despues
-- -- porque `add column ... default` escribe ese valor en TODAS las filas que
-- ya existen. Un solo `default` con el valor nuevo reescribiria el pasado.

create type public.tie_point_policy as enum (
  'same_position_points',
  'average_occupied_positions'
);

-- El ruleset de la competencia: se usa mientras no hay snapshot (la
-- previsualizacion antes de competir) y es lo que se copia al snapshot al
-- generarlo.
alter table public.events
  add column tie_point_policy public.tie_point_policy not null default 'same_position_points';

-- La AUTORIDAD una vez congelado el snapshot: cambiar la politica del evento
-- despues no puede tocar una competencia ya disputada.
alter table public.scoring_snapshots
  add column tie_point_policy public.tie_point_policy not null default 'same_position_points';

-- ---------------------------------------------------------------------------
-- guardar_snapshot_de_puntuacion: copia la politica del evento al congelar
-- ---------------------------------------------------------------------------

create or replace function public.guardar_snapshot_de_puntuacion(
  p_division_id uuid,
  p_field_size int,
  p_points numeric[],
  p_stage int default 1,
  p_lock boolean default false
)
returns public.scoring_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_bloqueado timestamptz;
  v_tie_policy public.tie_point_policy;
  v_fila public.scoring_snapshots;
begin
  select event_id into v_event_id from public.divisions where id = p_division_id;

  if v_event_id is null then
    raise exception 'La categoría no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para configurar la puntuación de esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  if p_points is null or array_length(p_points, 1) is null then
    raise exception 'La tabla de puntos no puede estar vacía';
  end if;

  select locked_at into v_bloqueado
  from public.scoring_snapshots
  where division_id = p_division_id and stage = p_stage;

  -- Una tabla bloqueada no se toca. Regenerarla cambiaria retroactivamente
  -- los puntos de las pruebas ya corridas.
  if v_bloqueado is not null then
    raise exception 'La tabla de puntuación de esta categoría ya está bloqueada: los puntos de las pruebas ya corridas no se pueden recalcular';
  end if;

  select tie_point_policy into v_tie_policy from public.events where id = v_event_id;

  insert into public.scoring_snapshots as s (
    event_id, division_id, stage, field_size, points, tie_point_policy, locked_at, created_by
  )
  values (
    v_event_id, p_division_id, p_stage, p_field_size, p_points, v_tie_policy,
    case when p_lock then now() end, auth.uid()
  )
  on conflict (division_id, stage) do update set
    field_size = excluded.field_size,
    points = excluded.points,
    -- Se vuelve a copiar en cada regeneracion (mientras siga sin bloquear):
    -- si el organizador cambio la politica del evento entre una
    -- previsualizacion y la siguiente, la ultima gana. Una vez bloqueado, la
    -- fila entera queda protegida por el guard de arriba y esto no se
    -- ejecuta mas para esa (division, stage).
    tie_point_policy = excluded.tie_point_policy,
    locked_at = excluded.locked_at,
    created_at = now(),
    created_by = excluded.created_by
  returning * into v_fila;

  return v_fila;
end;
$$;

-- ---------------------------------------------------------------------------
-- scoreboard_document: expone la politica de cada snapshot
-- ---------------------------------------------------------------------------

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
    -- Se mantiene en 5: agregar `tiePointPolicy` no cambia el resto de la forma.
    'version', 5,
    'detalle', p_detalle,
    'event', (
      select jsonb_build_object(
        'name', e.name,
        'venue', e.venue,
        'status', e.status,
        'format', e.format,
        'official', e.status = 'published',
        -- El default cuando ninguna categoria tiene snapshot todavia (la
        -- previsualizacion antes de competir).
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

select public.apply_function_lockdown();
