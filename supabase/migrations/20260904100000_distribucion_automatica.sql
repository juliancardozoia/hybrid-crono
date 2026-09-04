-- Distribucion automatica de atletas a heats, con jueces al azar.
--
-- EL PROBLEMA QUE RESUELVE
--
-- Con 80 atletas o mas, crear heats de a uno y asignar equipos a mano es
-- tedioso -- y asignar jueces a mano abre la puerta a que alguien elija a
-- proposito quien juzga a quien. `auto_distribuir_heats` arma TODOS los
-- heats de TODAS las categorias con atletas de una sola vez, con la cantidad
-- de carriles que pida el organizador, y reparte los jueces al azar.
--
-- POR QUE "Heat 1", "Heat 2"... SE REPITE EN CADA CATEGORIA
--
-- El nombre del heat era unico por EVENTO (`unique (event_id, name)`), asi
-- que "Heat 1" en Individual Masculino y "Heat 1" en Individual Femenino
-- chocaban. Pasa a ser unico por CATEGORIA: cada division numera la suya
-- desde 1, que es como se lee una planilla real.
--
-- POR QUE ES SEGURO CORRER ESTO DOS VECES
--
-- El organizador va a sumar categorias y atletas despues de la primera
-- corrida, y volver a correrlo tiene que RECALCULAR, no duplicar. Por
-- categoria: se borran los heats que TODAVIA NO ARRANCARON (sin eso, correr
-- de nuevo dejaria heats viejos y nuevos mezclados) y se arma la lista fresca
-- de equipos confirmados que no estan ya corriendo en un heat en marcha. Los
-- heats que YA ARRANCARON -- tengan o no marcajes -- no se tocan: esos
-- atletas siguen donde estan.

alter table public.heats
  drop constraint heats_event_id_name_key,
  add constraint heats_event_id_division_id_name_key unique (event_id, division_id, name);

create or replace function public.auto_distribuir_heats(
  p_event_id uuid,
  p_lanes_por_heat int
)
returns table (division_id uuid, division_name text, heats_creados int, equipos_asignados int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Solo la organización puede distribuir heats automáticamente'
      using errcode = 'insufficient_privilege';
  end if;

  if p_lanes_por_heat is null or p_lanes_por_heat < 1 or p_lanes_por_heat > 32 then
    raise exception 'La cantidad de carriles por heat tiene que estar entre 1 y 32';
  end if;

  -- El pool de jueces: cualquiera que ya figure en la pantalla de Jueces de
  -- este evento y este aprobado -- la misma gente que ya puede elegirse a
  -- mano en el selector de carril por carril. Se mezcla UNA sola vez para
  -- toda la corrida y se reparte por turno: es lo que hace la asignacion
  -- impredecible sin depender de que Postgres tenga una funcion de barajado.
  select array_agg(user_id order by random())
  into v_judge_ids
  from (
    select distinct s.user_id
    from public.event_staff s
    where s.event_id = p_event_id and s.user_id is not null and s.approved_at is not null
  ) jueces;

  if v_judge_ids is null or array_length(v_judge_ids, 1) = 0 then
    raise exception 'Todavía no hay jueces cargados en este evento';
  end if;

  v_judge_idx := 1;

  for v_division in
    select d.id, d.name from public.divisions d where d.event_id = p_event_id order by d.name
  loop
    -- El padron de esta categoria: equipos confirmados, no retirados, que no
    -- estan corriendo YA en un heat que arranco. Esos se dejan donde estan;
    -- el resto -- nuevos o en un heat todavia sin largar -- se reparte
    -- entero de nuevo.
    select array_agg(t.id order by t.bib_number)
    into v_team_ids
    from public.teams t
    where t.division_id = v_division.id
      and t.status <> 'withdrawn'
      and not exists (
        select 1 from public.lanes l
        join public.heats h on h.id = l.heat_id
        where l.team_id = t.id and h.started_at is not null
      );

    if v_team_ids is null or array_length(v_team_ids, 1) = 0 then
      continue;
    end if;

    -- Los numeros que ya usa un heat de esta categoria que arranco: la tanda
    -- nueva tiene que numerarse esquivandolos, no empezar de 1 y chocar.
    select coalesce(array_agg((regexp_match(h.name, '^Heat (\d+)$'))[1]::int), array[]::int[])
    into v_numeros_ocupados
    from public.heats h
    where h.event_id = p_event_id and h.division_id = v_division.id
      and h.started_at is not null and h.name ~ '^Heat \d+$';

    -- Se borran los heats de esta categoria que TODAVIA NO ARRANCARON: es lo
    -- que hace que correr esto de nuevo sea un recalculo y no una
    -- duplicacion. El cascade se lleva sus carriles (y sus timing_events, que
    -- no pueden existir sin que el heat haya arrancado).
    delete from public.heats h
    where h.event_id = p_event_id and h.division_id = v_division.id and h.started_at is null;

    v_heat_count := ceil(array_length(v_team_ids, 1)::numeric / p_lanes_por_heat);
    v_siguiente := 1;

    for v_i in 1..v_heat_count loop
      while v_siguiente = any(v_numeros_ocupados) loop
        v_siguiente := v_siguiente + 1;
      end loop;

      insert into public.heats (event_id, division_id, name, lane_count)
      values (p_event_id, v_division.id, 'Heat ' || v_siguiente, p_lanes_por_heat)
      returning id into v_new_heat_id;

      for v_lane_num in 1..p_lanes_por_heat loop
        v_team_idx := (v_i - 1) * p_lanes_por_heat + v_lane_num;
        exit when v_team_idx > array_length(v_team_ids, 1);

        insert into public.lanes (heat_id, event_id, lane_number, team_id, judge_id, claimed_at, lease_expires_at)
        values (
          v_new_heat_id, p_event_id, v_lane_num, v_team_ids[v_team_idx],
          v_judge_ids[1 + ((v_judge_idx - 1) % array_length(v_judge_ids, 1))],
          now(), now() + interval '6 hours'
        );

        v_judge_idx := v_judge_idx + 1;
      end loop;

      v_siguiente := v_siguiente + 1;
    end loop;

    division_id := v_division.id;
    division_name := v_division.name;
    heats_creados := v_heat_count;
    equipos_asignados := array_length(v_team_ids, 1);
    return next;
  end loop;
end;
$$;

select public.apply_function_lockdown();
