-- Un heat no larga hasta que todos sus atletas tengan juez.
--
-- POR QUE
--
-- Es la regla de la competencia, no una comodidad de la app: ningun atleta
-- corre sin alguien que le tome los parciales. Sin este control se podia largar
-- un heat con carriles sin juez, y esos atletas quedaban corriendo con el reloj
-- andando y nadie marcando: al terminar no habia forma de reconstruir sus
-- tiempos, porque no existian.
--
-- El orden correcto queda forzado por la base: los jueces toman sus carriles,
-- y recien entonces se larga.
--
-- Los carriles vacios (sin equipo) no cuentan: un heat de 6 carriles con 4
-- atletas necesita 4 jueces, no 6.

create or replace function public.start_heat(p_heat_id uuid)
returns public.heats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_heat public.heats;
  v_estado public.event_status;
  v_sin_juez int;
  v_con_atleta int;
begin
  select * into v_heat from public.heats where id = p_heat_id;

  if v_heat.id is null then
    raise exception 'El heat no existe';
  end if;

  if not public.can_verify_event(v_heat.event_id) then
    raise exception 'No tienes permiso para iniciar este heat'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotente: un doble tap en el boton de largada nunca puede reiniciar el
  -- reloj de seis atletas en carrera.
  if v_heat.started_at is not null then
    return v_heat;
  end if;

  select status into v_estado from public.events where id = v_heat.event_id;

  if v_estado = 'draft' then
    raise exception 'La competencia está en borrador. Márcala como lista y ponla en vivo antes de iniciar.';
  end if;

  if v_estado in ('verifying', 'published') then
    raise exception 'La competencia ya terminó: no se pueden iniciar heats nuevos.';
  end if;

  select
    count(*) filter (where team_id is not null),
    count(*) filter (where team_id is not null and judge_id is null)
  into v_con_atleta, v_sin_juez
  from public.lanes
  where heat_id = p_heat_id;

  if v_con_atleta = 0 then
    raise exception 'El heat no tiene ningún atleta asignado a sus carriles.';
  end if;

  if v_sin_juez > 0 then
    raise exception 'Faltan jueces: % de % carriles con atleta no tienen juez asignado.',
      v_sin_juez, v_con_atleta;
  end if;

  -- Largar el primer heat es lo que pone la competencia en vivo.
  if v_estado = 'ready' then
    update public.events set status = 'live' where id = v_heat.event_id;
  end if;

  update public.heats
  set started_at = now(),
      started_by = auth.uid(),
      start_source = 'server',
      status = 'running'
  where id = p_heat_id
  returning * into v_heat;

  update public.lanes
  set status = 'running'
  where heat_id = p_heat_id and status = 'idle' and team_id is not null;

  return v_heat;
end;
$$;

-- Deshace una largada hecha por error.
--
-- Solo si NO llego ningun marcaje: si un juez ya empezo a cronometrar, deshacer
-- la largada le borraria el ancla y sus parciales quedarian colgando de un cero
-- que ya no existe. En ese caso la salida es corregir marcajes, no reiniciar.
create or replace function public.cancel_heat_start(p_heat_id uuid)
returns public.heats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_heat public.heats;
  v_marcajes int;
begin
  select * into v_heat from public.heats where id = p_heat_id;

  if v_heat.id is null then
    raise exception 'El heat no existe';
  end if;

  if not public.can_verify_event(v_heat.event_id) then
    raise exception 'No tienes permiso sobre este heat'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_marcajes from public.timing_events where heat_id = p_heat_id;

  if v_marcajes > 0 then
    raise exception 'Este heat ya tiene % marcaje(s): no se puede deshacer el inicio.', v_marcajes;
  end if;

  update public.heats
  set started_at = null,
      started_by = null,
      start_source = null,
      status = 'scheduled'
  where id = p_heat_id
  returning * into v_heat;

  update public.lanes set status = 'idle' where heat_id = p_heat_id;

  return v_heat;
end;
$$;

select public.apply_function_lockdown();
