-- confirmar_corte_de_etapa dejaba confirmar el corte a la etapa 2 (o
-- cualquier posterior) sin que la etapa anterior hubiera corrido un solo
-- WOD: el pool ya se arma con TODOS los equipos activos (ver
-- getPuntuacionDelEvento), asi que un organizador podia armar el corte de
-- Etapa 2 antes de que la competencia largara. La pantalla ya avisaba
-- ("todavia no hay ningun resultado cargado") pero era solo un texto: el
-- boton de confirmar seguia habilitado.
--
-- La garantia va en la base, no en el cliente -- mismo criterio que el resto
-- del proyecto: una decision de negocio no puede depender de que el
-- componente de React se acuerde de deshabilitar un boton.
--
-- "La etapa anterior termino" se define como: todo equipo activo (no
-- retirado) de la categoria tiene un workout_scores en estado TERMINAL
-- (valido/capeado/dnf/dq) para CADA parte asignada a esa categoria cuyo
-- workout pertenece a la etapa anterior. Si esa etapa no tiene ninguna parte
-- asignada (division_id sin partes en stage = p_stage - 1), no hay nada que
-- exigir y el corte se deja pasar -- es el mismo caso border que ya tolera
-- el resto de la funcion.

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
  v_incompletos int;
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

  -- No se puede cortar a una etapa cuya anterior todavia no termino: cada
  -- equipo activo tiene que tener un resultado TERMINAL en cada parte de la
  -- etapa previa asignada a esta categoria.
  --
  -- Una parte de circuito NUNCA escribe en `workout_scores` -- su resultado
  -- vive en `results`, atado al carril (ver recompute.ts, que excluye
  -- explicitamente `time_scheme = 'circuito'` de esa tabla). Un WOD normal es
  -- al reves. Mirar solo `workout_scores` habria dejado una categoria de
  -- carrera hibrida sin forma de completar nunca su etapa 1.
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

  if v_incompletos > 0 then
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
