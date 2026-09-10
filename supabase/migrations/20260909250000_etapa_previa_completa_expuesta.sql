-- La pantalla de puntuacion dejaba TILDAR equipos y apretar "Confirmar
-- corte" aunque la etapa anterior no hubiera terminado -- el unico aviso era
-- un texto que desaparecia apenas UN equipo tenia un resultado, sin bloquear
-- nada. `confirmar_corte_de_etapa` (20260909240000) ya lo rechaza al
-- guardar, pero eso deja al organizador armar la seleccion entera para
-- recien enterarse al final. La pantalla necesita la MISMA respuesta antes
-- de mostrar la lista como elegible.
--
-- Se extrae el chequeo a una funcion propia, en vez de duplicarlo: es
-- exactamente el motivo por el que el proyecto tiene UN reductor de tiempos
-- y UN motor de scoring -- dos copias de la misma regla divergen tarde o
-- temprano.

create or replace function public.etapa_previa_completa(p_division_id uuid, p_stage int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_incompletos int;
begin
  select event_id into v_event_id from public.divisions where id = p_division_id;

  if v_event_id is null or not public.puede_leer_evento(v_event_id) then
    return false;
  end if;

  select count(*) into v_incompletos
  from public.teams t
  cross join (
    select p.id, p.workout_id, p.time_scheme
    from public.part_divisions pd
    join public.workout_parts p on p.id = pd.part_id
    join public.workouts w on w.id = p.workout_id
    where pd.division_id = p_division_id and w.stage = p_stage - 1
  ) parte
  left join public.workout_scores ws on ws.part_id = parte.id and ws.team_id = t.id
  left join public.lanes l on l.workout_id = parte.workout_id and l.team_id = t.id
  left join public.results r on r.lane_id = l.id
  where t.division_id = p_division_id
    and t.status <> 'withdrawn'
    and (
      case
        when parte.time_scheme = 'circuito' then
          r.status is null or r.status not in ('finished', 'dnf', 'dq')
        else
          ws.status is null or ws.status not in ('valido', 'capeado', 'dnf', 'dq')
      end
    );

  return v_incompletos = 0;
end;
$$;

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

  if not public.etapa_previa_completa(p_division_id, p_stage) then
    raise exception 'La etapa anterior todavía no terminó: hay equipos sin resultado final en alguna de sus pruebas';
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

select public.apply_function_lockdown();
