-- "Cuantos marcajes se pierden al deshacer la largada", en UN solo lugar.
--
-- La definicion de marcaje ACTIVO de un heat (no anulado, no reemplazado por un
-- `undo`, ni `lane_start`/`undo`, y de la largada vigente) estaba escrita dos
-- veces -una en `cancel_heat_start` y otra en `deshacer_largada_completa`- y
-- ahora la necesita una tercera la pantalla de Control, para decirle a la
-- organizacion CUANTOS marcajes va a anular antes de que confirme. Tres copias
-- de una regla que decide si se pierde un tiempo terminan diciendo cosas
-- distintas: se extrae a una funcion y las dos existentes la llaman.

create or replace function public.heat_marcajes_activos(p_heat_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event uuid;
  v_generation int;
  v_marcajes int;
begin
  select event_id, start_generation into v_event, v_generation
  from public.heats
  where id = p_heat_id;

  if v_event is null then
    return 0;
  end if;

  if not public.can_verify_event(v_event) then
    raise exception 'No tienes permiso sobre este heat'
      using errcode = 'insufficient_privilege';
  end if;

  -- Misma definicion de "activo" que `reduceLaneEvents`: sin anulados, sin los
  -- reemplazados por un `undo` (aunque ese `undo` este anulado: el reductor
  -- tampoco lo mira), y sin `lane_start`/`undo`, que no llevan ningun dato.
  select count(*)::int into v_marcajes
  from public.timing_events te
  where te.heat_id = p_heat_id
    and te.start_generation = v_generation
    and not te.voided
    and te.type not in ('lane_start', 'undo')
    and not exists (select 1 from public.timing_events u where u.supersedes_id = te.id);

  return v_marcajes;
end;
$$;

-- Lo que la torre de control necesita: los heats EN CURSO del evento y cuantos
-- marcajes reales tiene cada uno. Un solo viaje en vez de uno por heat.
create or replace function public.event_heat_marcajes(p_event_id uuid)
returns table (heat_id uuid, marcajes int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.id, public.heat_marcajes_activos(h.id)
  from public.heats h
  where h.event_id = p_event_id
    and h.started_at is not null
    and h.ended_at is null
    and public.can_verify_event(p_event_id);
$$;

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

  v_marcajes := public.heat_marcajes_activos(p_heat_id);

  if v_marcajes > 0 then
    raise exception 'Este heat ya tiene % marcaje(s): no se puede deshacer el inicio.', v_marcajes;
  end if;

  update public.heats
  set started_at = null,
      started_by = null,
      start_source = null,
      ended_at = null,
      status = 'scheduled',
      start_generation = start_generation + 1
  where id = p_heat_id
  returning * into v_heat;

  update public.lanes set status = 'idle' where heat_id = p_heat_id;

  return v_heat;
end;
$$;

create or replace function public.deshacer_largada_completa(
  p_heat_id uuid,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_heat public.heats;
  v_reales int;
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Escribe el motivo de deshacer la largada.';
  end if;

  select * into v_heat from public.heats where id = p_heat_id for update;

  if v_heat.id is null then
    raise exception 'El heat no existe';
  end if;

  if not public.can_verify_event(v_heat.event_id) then
    raise exception 'No tienes permiso sobre este heat'
      using errcode = 'insufficient_privilege';
  end if;

  if v_heat.started_at is null then
    raise exception 'El heat no está largado: no hay nada que deshacer.';
  end if;

  -- Un atleta que ya termino (o al que se le marco DNF/DQ) tiene un tiempo
  -- REAL: eso deja de ser "una largada por error". Se corrige desde
  -- Verificacion, con su propio rastro, no borrando la carrera entera.
  if exists (
       select 1 from public.results r
       join public.lanes l on l.id = r.lane_id
       where l.heat_id = p_heat_id and r.status in ('finished', 'dnf', 'dq')
     )
     or exists (
       select 1 from public.workout_scores ws
       join public.lanes l on l.id = ws.lane_id
       where l.heat_id = p_heat_id and ws.status in ('valido', 'capeado', 'dnf', 'dq')
     )
  then
    raise exception 'Este heat ya tiene atletas que terminaron: no se puede deshacer la largada completa.';
  end if;

  v_reales := public.heat_marcajes_activos(p_heat_id);

  -- Se anula TODO lo activo de esta generacion, incluidos `lane_start` y
  -- `undo`: asi el log del heat queda diciendo, sin ambiguedad, que esa
  -- largada no cuenta.
  update public.timing_events
  set voided = true,
      void_reason = 'Largada deshecha: ' || trim(p_reason),
      voided_by = auth.uid(),
      voided_at = now()
  where heat_id = p_heat_id
    and start_generation = v_heat.start_generation
    and not voided;

  -- Con todo anulado el guard de `cancel_heat_start` da cero: reusarlo evita
  -- una segunda copia de "que hay que resetear al deshacer una largada".
  perform public.cancel_heat_start(p_heat_id);

  return v_reales;
end;
$$;

select public.apply_function_lockdown();
