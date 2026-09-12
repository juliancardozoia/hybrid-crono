-- `assign_heat_lanes` no dejaba armar heats a mano: fallaba SIEMPRE con
-- "DELETE requires a WHERE clause", codigo 21000.
--
-- La causa: `delete from tmp_lane_judges;` (agregada en
-- 20260907200000_assign_heat_lanes_conserva_jueces para preservar el juez de
-- un carril al reasignar) no lleva WHERE. La base real de Supabase rechaza
-- cualquier DELETE sin filtro -- PGlite (supabase/tests/) no reproduce esta
-- restriccion, por eso los 690+ tests locales pasaban con la funcion rota: es
-- el mismo tipo de brecha que ya documenta el proyecto para los embeds de
-- PostgREST, pero para esta guarda de la base real.
--
-- La linea ademas es REDUNDANTE: la tabla es `on commit drop`, asi que cada
-- llamada a la funcion (una transaccion nueva) la encuentra recien creada y
-- vacia. Se mantiene un DELETE defensivo, ahora con WHERE, en vez de
-- borrarla entera: si alguna vez la funcion se invoca dos veces dentro de la
-- MISMA transaccion (un savepoint, por ejemplo), sigue limpiando cualquier
-- resto en vez de asumir que siempre esta vacia.
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
  delete from tmp_lane_judges where lane_number is not null;

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
