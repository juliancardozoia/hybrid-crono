-- `cancel_heat_start()` nunca ponia `ended_at = null` en su UPDATE, aunque la
-- columna ya existia (agregada despues, en 20260903200000_control_heats_reforzado).
-- Hoy no se puede observar el bug -- `ended_at` solo lo llena
-- `actualizarCierreDeHeat()` cuando TODOS los carriles con atleta llegan a un
-- estado terminal, y eso siempre implica al menos un `timing_event`, que es
-- justo lo que esta funcion exige en cero para dejar deshacer -- pero es un
-- acoplamiento fragil, no una garantia explicita: si el dia de mañana un
-- estado terminal deja de depender de un timing_event, "deshacer el inicio"
-- podria dejar el heat con `ended_at` pegado. Se agrega como defensa
-- explicita, no porque haya un caso real que lo dispare hoy.
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
      ended_at = null,
      status = 'scheduled'
  where id = p_heat_id
  returning * into v_heat;

  update public.lanes set status = 'idle' where heat_id = p_heat_id;

  return v_heat;
end;
$$;

select public.apply_function_lockdown();
