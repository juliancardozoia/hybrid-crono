-- Etapas y cortes: "Stage 1 con 40 -> cut -> Stage 2 con 20 -> cut -> Final".
--
-- `scoring_snapshots` ya era `(division_id, stage, ...)` desde que se creo,
-- a proposito, para no tener que migrar nada el dia que esto se construyera.
-- Lo que faltaba: que WOD pertenece a que etapa, y quien avanza de una a la
-- siguiente.
--
-- LA ETAPA ES DEL WORKOUT, NO DE LA PARTE. Un WOD con partes A/B corre las
-- dos en la misma etapa siempre; ponerlo a nivel de parte multiplicaria los
-- lugares donde configurarlo sin ningun caso real que lo necesite.
--
-- QUIEN AVANZA ES UNA DECISION EXPLICITA, NUNCA AUTOMATICA. Empates justo en
-- la linea de corte, un DQ pendiente de revision, una lesion: el organizador
-- tiene que poder ajustar antes de confirmar. La etapa 1 no necesita filas
-- aca -- todo equipo activo participa -- asi que la tabla solo tiene filas
-- desde la etapa 2 en adelante.

alter table public.workouts
  add column stage int not null default 1 check (stage >= 1);

create table public.stage_advancements (
  event_id uuid not null,
  division_id uuid not null,
  stage int not null check (stage >= 2),
  team_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (division_id, stage, team_id),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade,
  foreign key (team_id, event_id)
    references public.teams (id, event_id) on delete cascade
);

create index stage_advancements_event_idx on public.stage_advancements (event_id, stage);

alter table public.stage_advancements enable row level security;

create policy stage_advancements_read on public.stage_advancements
  for select using (public.puede_leer_evento(event_id));

-- Sin GRANT de escritura directa, igual que `scoring_snapshots` y
-- `timing_events`: se escribe SOLO por `confirmar_corte_de_etapa`.
revoke all on public.stage_advancements from anon, authenticated;
grant select on public.stage_advancements to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmar el corte Y congelar la tabla de la etapa siguiente: LA MISMA
-- operacion, en una transaccion. Dos llamadas separadas (avanzar, despues
-- congelar) dejarian una ventana donde alguien avanzo sin tabla, o con la
-- tabla de otro tamano si algo fallara entre medio.
-- ---------------------------------------------------------------------------

create or replace function public.confirmar_corte_de_etapa(
  p_division_id uuid,
  p_stage int,
  p_team_ids uuid[],
  p_points numeric[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_bloqueado timestamptz;
begin
  select event_id into v_event_id from public.divisions where id = p_division_id;

  if v_event_id is null then
    raise exception 'La categoría no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para configurar la puntuación de esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  if p_stage < 2 then
    raise exception 'Un corte solo puede confirmarse hacia la etapa 2 o una posterior';
  end if;

  if p_team_ids is null or array_length(p_team_ids, 1) is null then
    raise exception 'Elegí al menos un equipo que avance';
  end if;

  if p_points is null or array_length(p_points, 1) <> array_length(p_team_ids, 1) then
    raise exception 'La tabla de puntos no coincide con la cantidad de equipos';
  end if;

  select locked_at into v_bloqueado
  from public.scoring_snapshots
  where division_id = p_division_id and stage = p_stage;

  -- Un corte confirmado no se rehace solo: mismo criterio que
  -- guardar_snapshot_de_puntuacion, y por la misma razon -- recalcularlo
  -- cambiaria retroactivamente los puntos de las pruebas ya corridas en esa
  -- etapa.
  if v_bloqueado is not null then
    raise exception 'El corte de esta etapa ya está confirmado y no se puede rehacer';
  end if;

  delete from public.stage_advancements
  where division_id = p_division_id and stage = p_stage;

  insert into public.stage_advancements (event_id, division_id, stage, team_id, created_by)
  select v_event_id, p_division_id, p_stage, equipo, auth.uid()
  from unnest(p_team_ids) as equipo;

  insert into public.scoring_snapshots (
    event_id, division_id, stage, field_size, points, locked_at, created_by
  )
  values (
    v_event_id, p_division_id, p_stage, array_length(p_team_ids, 1), p_points,
    now(), auth.uid()
  )
  on conflict (division_id, stage) do update set
    field_size = excluded.field_size,
    points = excluded.points,
    locked_at = excluded.locked_at,
    created_at = now(),
    created_by = excluded.created_by;
end;
$$;

-- ---------------------------------------------------------------------------
-- El documento del leaderboard: cada parte dice de que etapa es, y viaja
-- quien avanzo a cada etapa.
-- ---------------------------------------------------------------------------

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
    -- Una fila por (categoria, etapa) que ya tenga tabla generada o
    -- congelada. Antes esto vivia adentro de `divisions` como un snapshot
    -- singular; ahora una categoria puede tener una fila por etapa.
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

select public.apply_function_lockdown();
