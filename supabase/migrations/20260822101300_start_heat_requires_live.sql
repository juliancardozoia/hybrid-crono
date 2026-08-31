-- La largada de un heat exige que la competencia este publicada como en curso.
--
-- POR QUE
--
-- Antes se podia largar un heat con el evento todavia en 'draft'. El resultado
-- era un estado incoherente que nadie entendia: el heat corriendo, el reloj
-- andando, y la pantalla del juez vacia — porque el juez solo ve competencias
-- en 'ready' o 'live'. El organizador no tenia forma de deducir que le faltaba
-- tocar "Poner en vivo".
--
-- Ahora largar un heat IMPLICA que la competencia arranco: si estaba 'ready',
-- pasa sola a 'live'. Y si esta en 'draft' se rechaza con un mensaje que dice
-- exactamente que hacer.

create or replace function public.start_heat(p_heat_id uuid)
returns public.heats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_heat public.heats;
  v_estado public.event_status;
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

select public.apply_function_lockdown();
