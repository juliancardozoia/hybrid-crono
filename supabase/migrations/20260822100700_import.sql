-- Import masivo de equipos y atletas.
--
-- Existe como funcion y no como una serie de inserts desde la app por una sola
-- razon: atomicidad. Un import de 300 atletas que falla en el 180 y deja la
-- mitad cargada es peor que uno que no corre: el organizador no sabe donde
-- quedo, y limpiar a mano la noche antes de la competencia es exactamente el
-- problema que esta app viene a eliminar.
--
-- Toda la funcion corre en una transaccion: o entran todos, o no entra ninguno.
--
-- Recibe el plan ya validado por el cliente (buildImportPlan). La base igual
-- vuelve a hacer valer sus constraints: dorsal unico, division existente y del
-- mismo evento.

create or replace function public.import_teams(p_event_id uuid, p_teams jsonb)
returns table (bib_number int, team_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team jsonb;
  v_member jsonb;
  v_team_id uuid;
  v_athlete_id uuid;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'No tienes permiso para cargar atletas en este evento'
      using errcode = 'insufficient_privilege';
  end if;

  if p_teams is null or jsonb_typeof(p_teams) <> 'array' then
    raise exception 'Se esperaba un arreglo de equipos';
  end if;

  for v_team in select value from jsonb_array_elements(p_teams) as t(value)
  loop
    insert into public.teams (event_id, division_id, name, bib_number)
    values (
      p_event_id,
      (v_team ->> 'divisionId')::uuid,
      nullif(trim(coalesce(v_team ->> 'name', '')), ''),
      (v_team ->> 'bibNumber')::int
    )
    returning id into v_team_id;

    for v_member in select value from jsonb_array_elements(v_team -> 'members') as m(value)
    loop
      insert into public.athletes (
        event_id, first_name, last_name, birth_date, gender, email, phone, external_ref
      )
      values (
        p_event_id,
        v_member ->> 'firstName',
        v_member ->> 'lastName',
        nullif(v_member ->> 'birthDate', '')::date,
        nullif(v_member ->> 'gender', '')::public.athlete_gender,
        nullif(v_member ->> 'email', ''),
        nullif(v_member ->> 'phone', ''),
        nullif(v_member ->> 'externalRef', '')
      )
      returning id into v_athlete_id;

      insert into public.team_members (team_id, athlete_id, event_id)
      values (v_team_id, v_athlete_id, p_event_id);
    end loop;

    bib_number := (v_team ->> 'bibNumber')::int;
    team_id := v_team_id;
    return next;
  end loop;
end;
$$;

grant execute on function public.import_teams(uuid, jsonb) to authenticated;

-- Arma los carriles de un heat de una sola vez.
--
-- Mismo criterio: `unique (heat_id, lane_number)` y el indice que impide que un
-- equipo corra dos veces hacen que una carga fila por fila desde el cliente
-- pueda fallar a mitad y dejar el heat a medio armar.
create or replace function public.assign_heat_lanes(p_heat_id uuid, p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_lane_count int;
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

  for i in 1..coalesce(array_length(p_team_ids, 1), 0)
  loop
    insert into public.lanes (heat_id, event_id, lane_number, team_id)
    values (p_heat_id, v_event_id, i, p_team_ids[i]);
  end loop;
end;
$$;

grant execute on function public.assign_heat_lanes(uuid, uuid[]) to authenticated;
