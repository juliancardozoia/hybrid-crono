-- Reasignar los equipos de un heat no puede borrar los jueces ya asignados.
--
-- `assign_heat_lanes` borra TODAS las filas de `lanes` del heat y las vuelve
-- a crear. Eso es correcto para reordenar equipos, pero de paso perdia
-- `judge_id`/`claimed_at`/`lease_expires_at` de cada carril sin avisar: un
-- organizador que asignaba los seis jueces de un heat y despues volvia a
-- "Guardar carriles" -- por ejemplo para sumar un equipo que llego tarde --
-- se encontraba el heat sin ningun juez, en silencio. `start_heat()` recien
-- lo hubiera detectado al intentar largar, con el heat completo ya armado.
--
-- El juez esta atado a una POSICION fisica (el carril N), no a un equipo: es
-- quien esta parado ahi mirando a quien sea que corra. Por eso se preserva
-- por `lane_number`, y sigue siendo correcto que un `lane_id` nuevo pierda su
-- historial de auditoria propio -- la asignacion original ya quedo en
-- `lane_audit`, esto solo evita perder el DATO de quien esta asignado hoy.
create or replace function public.assign_heat_lanes(p_heat_id uuid, p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_lane_count int;
  v_asignados int;
  v_no_aprobados text;
  i int;
begin
  select event_id, lane_count into v_event_id, v_lane_count
  from public.heats where id = p_heat_id;

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

select public.apply_function_lockdown();
