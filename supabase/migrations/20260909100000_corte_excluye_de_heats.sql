-- Un equipo eliminado por un corte no puede volver a ser elegible para heats
-- de una etapa posterior.
--
-- El leaderboard (scoreboard.ts, migracion anterior) ya sabe que un corte
-- reduce quien sigue compitiendo sin borrar sus puntos. Pero nada en la base
-- impedia que ese mismo equipo terminara igual en un carril de un WOD de la
-- etapa siguiente: ni `assign_heat_lanes` (la asignacion manual desde /heats)
-- ni `auto_distribuir_heats` miraban `stage_advancements`. Las dos filtraban
-- por `part_divisions` (que categoria corre que prueba), `status <>
-- withdrawn` y `approved`, pero no por "avanzo al corte de esta etapa".
--
-- LA REGLA: un WOD de `workouts.stage = 1` no tiene restriccion -- todo
-- equipo activo participa, no hay corte que haber pasado. Un WOD de
-- `stage >= 2` solo admite equipos que figuren en `stage_advancements` para
-- (division_id, esa etapa). Si el corte de esa etapa todavia no se confirmo,
-- NADIE es elegible todavia -- mismo criterio que ya aplica el leaderboard
-- ("sin corte confirmado, nadie avanzo todavia").

-- ---------------------------------------------------------------------------
-- 1. Asignacion manual (`/heats`, HeatCard "Guardar carriles")
-- ---------------------------------------------------------------------------
create or replace function public.assign_heat_lanes(p_heat_id uuid, p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_division_id uuid;
  v_stage int;
  v_lane_count int;
  v_asignados int;
  v_no_aprobados text;
  v_no_avanzaron text;
  i int;
begin
  select h.event_id, h.division_id, h.lane_count, w.stage
  into v_event_id, v_division_id, v_lane_count, v_stage
  from public.heats h
  join public.workouts w on w.id = h.workout_id
  where h.id = p_heat_id;

  if v_event_id is null then
    raise exception 'El heat no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para armar este heat'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(array_length(p_team_ids, 1), 0) > v_lane_count then
    raise exception 'El heat tiene % carriles y se intentaron asignar %',
      v_lane_count, array_length(p_team_ids, 1);
  end if;

  select string_agg(coalesce(t.name, '#' || t.bib_number::text), ', ')
  into v_no_aprobados
  from public.teams t
  where t.id = any(p_team_ids) and not t.approved;

  if v_no_aprobados is not null then
    raise exception 'Estos equipos todavía no están aprobados: %', v_no_aprobados;
  end if;

  -- Un heat de etapa 2 o mayor solo admite a quien avanzo AL CORTE de esa
  -- etapa. `division_id` nulo (heat mixto, un resabio del modelo viejo que
  -- la app ya no ofrece crear) no puede validarse contra un corte: se deja
  -- pasar como ya pasaba antes, sin filtro por etapa.
  if v_stage >= 2 and v_division_id is not null then
    select string_agg(coalesce(t.name, '#' || t.bib_number::text), ', ')
    into v_no_avanzaron
    from public.teams t
    where t.id = any(p_team_ids)
      and not exists (
        select 1 from public.stage_advancements sa
        where sa.division_id = v_division_id
          and sa.stage = v_stage
          and sa.team_id = t.id
      );

    if v_no_avanzaron is not null then
      raise exception 'Estos equipos no avanzaron al corte de esta etapa: %', v_no_avanzaron;
    end if;
  end if;

  -- Se rehace la asignacion completa. Solo se permite mientras el heat no
  -- arranco: tocar los carriles de un heat en curso dejaria marcajes apuntando
  -- a un equipo que ya no esta ahi.
  if exists (select 1 from public.heats where id = p_heat_id and started_at is not null) then
    raise exception 'El heat ya inició: no se pueden reasignar los carriles';
  end if;

  create temporary table if not exists tmp_lane_judges (
    lane_number int primary key,
    judge_id uuid,
    claimed_at timestamptz,
    lease_expires_at timestamptz
  ) on commit drop;
  delete from tmp_lane_judges;

  insert into tmp_lane_judges (lane_number, judge_id, claimed_at, lease_expires_at)
  select lane_number, judge_id, claimed_at, lease_expires_at
  from public.lanes
  where heat_id = p_heat_id and judge_id is not null;

  delete from public.lanes where heat_id = p_heat_id;

  v_asignados := 0;

  for i in 1..coalesce(array_length(p_team_ids, 1), 0)
  loop
    -- NULL = carril vacio. Se saltea sin consumir el numero: el carril 3 sigue
    -- siendo el 3 aunque el 1 y el 2 esten libres.
    if p_team_ids[i] is not null then
      insert into public.lanes (heat_id, event_id, lane_number, team_id)
      values (p_heat_id, v_event_id, i, p_team_ids[i]);
      v_asignados := v_asignados + 1;
    end if;
  end loop;

  if v_asignados = 0 then
    raise exception 'No se asigno ningun equipo a los carriles';
  end if;

  update public.lanes l
  set judge_id = t.judge_id,
      claimed_at = t.claimed_at,
      lease_expires_at = t.lease_expires_at
  from tmp_lane_judges t
  where l.heat_id = p_heat_id and l.lane_number = t.lane_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Distribucion automatica
-- ---------------------------------------------------------------------------
-- `create or replace` alcanza: la aridad y el `returns table` no cambian
-- respecto de la version anterior (20260905100000_heat_elige_su_prueba).
create or replace function public.auto_distribuir_heats(
  p_event_id uuid,
  p_lanes_por_heat int,
  -- null = todas las pruebas del evento.
  p_workout_id uuid default null
)
returns table (
  workout_id uuid,
  workout_name text,
  division_id uuid,
  division_name text,
  heats_creados int,
  equipos_asignados int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workout record;
  v_division record;
  v_team_ids uuid[];
  v_judge_ids uuid[];
  v_numeros_ocupados int[];
  v_heat_count int;
  v_siguiente int;
  v_i int;
  v_lane_num int;
  v_team_idx int;
  v_new_heat_id uuid;
  v_judge_idx int;
  v_heat_prev_judges uuid[];
  v_heat_actual_judges uuid[];
  v_candidate uuid;
  v_try uuid;
  v_found boolean;
  v_scan int;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Solo la organización puede distribuir heats automáticamente'
      using errcode = 'insufficient_privilege';
  end if;

  if p_lanes_por_heat is null or p_lanes_por_heat < 1 or p_lanes_por_heat > 32 then
    raise exception 'La cantidad de carriles por heat tiene que estar entre 1 y 32';
  end if;

  if p_workout_id is not null and not exists (
    select 1 from public.workouts w
    where w.id = p_workout_id and w.event_id = p_event_id
  ) then
    raise exception 'Esa prueba no pertenece a esta competencia';
  end if;

  -- El pool de jueces: cualquiera que ya figure en la pantalla de Jueces de
  -- este evento y este aprobado. Puede venir VACIO, y no es un error: los
  -- carriles quedan libres y el organizador los asigna despues. La garantia de
  -- "no se larga un heat sin juez" vive en start_heat(), no aca.
  select array_agg(user_id order by random())
  into v_judge_ids
  from (
    select distinct s.user_id
    from public.event_staff s
    where s.event_id = p_event_id and s.user_id is not null and s.approved_at is not null
  ) jueces;

  v_judge_idx := 1;

  for v_workout in
    select w.id, w.name, w.stage
    from public.workouts w
    where w.event_id = p_event_id
      and (p_workout_id is null or w.id = p_workout_id)
    order by w.order_index
  loop
    -- Solo las categorias que CORREN esta prueba. part_divisions es la
    -- respuesta a "quien corre que" y es explicita a proposito (ver el
    -- comentario de la tabla en 20260901100000): una categoria que no esta ahi
    -- no corre esta prueba, y no puede tener heats de ella.
    for v_division in
      select d.id, d.name
      from public.divisions d
      where d.event_id = p_event_id
        and exists (
          select 1
          from public.part_divisions pd
          join public.workout_parts wp on wp.id = pd.part_id
          where pd.division_id = d.id and wp.workout_id = v_workout.id
        )
      order by d.name
    loop
      -- El padron de esta categoria PARA ESTA PRUEBA: equipos confirmados,
      -- aprobados, no retirados, que no esten corriendo ya esta misma prueba en
      -- un heat que arranco. Los que ya corrieron OTRA prueba entran igual.
      --
      -- Si la prueba es de una etapa 2 o mayor, ademas tienen que haber
      -- avanzado AL CORTE de esa etapa: un equipo eliminado no vuelve a ser
      -- elegible, aunque su categoria siga corriendo otras pruebas.
      select array_agg(t.id order by t.bib_number)
      into v_team_ids
      from public.teams t
      where t.division_id = v_division.id
        and t.status <> 'withdrawn'
        and t.approved
        and (
          v_workout.stage < 2
          or exists (
            select 1 from public.stage_advancements sa
            where sa.division_id = v_division.id
              and sa.stage = v_workout.stage
              and sa.team_id = t.id
          )
        )
        and not exists (
          select 1 from public.lanes l
          join public.heats h on h.id = l.heat_id
          where l.team_id = t.id
            and l.workout_id = v_workout.id
            and h.started_at is not null
        );

      if v_team_ids is null or array_length(v_team_ids, 1) = 0 then
        continue;
      end if;

      -- Los numeros que ya usa un heat LARGADO de esta prueba y categoria: la
      -- tanda nueva se numera esquivandolos, no empezando de 1 y chocando.
      select coalesce(array_agg((regexp_match(h.name, '^Heat (\d+)$'))[1]::int), array[]::int[])
      into v_numeros_ocupados
      from public.heats h
      where h.event_id = p_event_id
        and h.workout_id = v_workout.id
        and h.division_id = v_division.id
        and h.started_at is not null
        and h.name ~ '^Heat \d+$';

      -- Se borran los heats de ESTA prueba y categoria que todavia no
      -- arrancaron: es lo que hace que correr esto de nuevo sea un recalculo y
      -- no una duplicacion. El cascade se lleva sus carriles.
      delete from public.heats h
      where h.event_id = p_event_id
        and h.workout_id = v_workout.id
        and h.division_id = v_division.id
        and h.started_at is null;

      v_heat_count := ceil(array_length(v_team_ids, 1)::numeric / p_lanes_por_heat);
      v_siguiente := 1;
      -- La memoria de jueces se reinicia por (prueba, categoria): "no repetir
      -- juez en heats seguidos" es dentro de una tanda, y dos pruebas distintas
      -- corren en horarios distintos.
      v_heat_prev_judges := array[]::uuid[];

      for v_i in 1..v_heat_count loop
        while v_siguiente = any(v_numeros_ocupados) loop
          v_siguiente := v_siguiente + 1;
        end loop;

        insert into public.heats (event_id, workout_id, division_id, name, lane_count)
        values (
          p_event_id, v_workout.id, v_division.id,
          'Heat ' || v_siguiente, p_lanes_por_heat
        )
        returning id into v_new_heat_id;

        v_heat_actual_judges := array[]::uuid[];

        for v_lane_num in 1..p_lanes_por_heat loop
          v_team_idx := (v_i - 1) * p_lanes_por_heat + v_lane_num;
          exit when v_team_idx > array_length(v_team_ids, 1);

          v_candidate := null;

          if v_judge_ids is not null and array_length(v_judge_ids, 1) > 0 then
            -- Busca, siguiendo la rotacion desde el cursor, el primer juez que
            -- no haya quedado en ESTE heat ni en el ANTERIOR de la tanda.
            v_found := false;
            for v_scan in 0..array_length(v_judge_ids, 1) - 1 loop
              v_try := v_judge_ids[1 + ((v_judge_idx - 1 + v_scan) % array_length(v_judge_ids, 1))];
              if not (v_try = any(v_heat_actual_judges))
                 and not (v_try = any(v_heat_prev_judges)) then
                v_candidate := v_try;
                v_found := true;
                exit;
              end if;
            end loop;

            -- Con pocos jueces puede no haber ninguno que cumpla las dos
            -- condiciones: mejor esfuerzo, se cae a la rotacion plana en vez de
            -- dejar el carril sin juez pudiendo evitarlo.
            if not v_found then
              v_candidate := v_judge_ids[1 + ((v_judge_idx - 1) % array_length(v_judge_ids, 1))];
            end if;

            v_judge_idx := v_judge_idx + 1;
            v_heat_actual_judges := array_append(v_heat_actual_judges, v_candidate);
          end if;

          if v_candidate is not null then
            insert into public.lanes (heat_id, event_id, lane_number, team_id, judge_id, claimed_at, lease_expires_at)
            values (
              v_new_heat_id, p_event_id, v_lane_num, v_team_ids[v_team_idx],
              v_candidate, now(), now() + interval '6 hours'
            );
          else
            -- Sin jueces cargados todavia: el carril queda libre, igual que
            -- cualquier carril que un organizador arma a mano sin asignar.
            insert into public.lanes (heat_id, event_id, lane_number, team_id)
            values (v_new_heat_id, p_event_id, v_lane_num, v_team_ids[v_team_idx]);
          end if;
        end loop;

        v_heat_prev_judges := v_heat_actual_judges;
        v_siguiente := v_siguiente + 1;
      end loop;

      workout_id := v_workout.id;
      workout_name := v_workout.name;
      division_id := v_division.id;
      division_name := v_division.name;
      heats_creados := v_heat_count;
      equipos_asignados := array_length(v_team_ids, 1);
      return next;
    end loop;
  end loop;
end;
$$;

select public.apply_function_lockdown();
