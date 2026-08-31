-- Armar carriles conservando el numero de cada uno.
--
-- QUE ESTABA MAL
--
-- La funcion recibia un arreglo de equipos y usaba el INDICE como numero de
-- carril. El cliente, antes de mandarlo, le sacaba los huecos con filter(). El
-- resultado: si el organizador dejaba el carril 1 vacio y ponia un equipo en el
-- 2, el equipo terminaba corriendo en el carril 1.
--
-- No rompia nada visiblemente —los tiempos igual se tomaban— pero el numero de
-- carril de la pantalla del juez dejaba de coincidir con el carril fisico del
-- venue. Con seis atletas largando juntos, eso es exactamente como se le toma el
-- tiempo al atleta equivocado.
--
-- Ahora el arreglo llega COMPLETO, con NULL en los carriles vacios, y la
-- posicion en el arreglo vuelve a ser el numero de carril real.

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

  -- Se rehace la asignacion completa. Solo se permite mientras el heat no
  -- arranco: tocar los carriles de un heat en curso dejaria marcajes apuntando
  -- a un equipo que ya no esta ahi.
  if exists (select 1 from public.heats where id = p_heat_id and started_at is not null) then
    raise exception 'El heat ya inició: no se pueden reasignar los carriles';
  end if;

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
end;
$$;

select public.apply_function_lockdown();
