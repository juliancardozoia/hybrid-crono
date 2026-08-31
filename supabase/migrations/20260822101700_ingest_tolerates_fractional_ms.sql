-- La ingesta tolera elapsedMs con decimales.
--
-- QUE PASABA
--
-- `performance.now()` tiene precision sub-milisegundo, asi que el elapsed que
-- calcula el cronometro es un decimal: 190177.19999992847. La columna
-- `elapsed_ms` es int y el cast `::int` fallaba:
--
--     invalid input syntax for type integer: "190177.19999992847"
--
-- Mismo efecto que el bug de la fecha: la excepcion abortaba el lote entero y
-- cada sincronizacion fallaba.
--
-- Se redondea, no se trunca. La diferencia es menor a un milisegundo y no
-- cambia ningun ranking, pero redondear es lo correcto: truncar sesgaria todos
-- los tiempos hacia abajo de forma sistematica.
--
-- El arreglo va del lado del servidor para que los marcajes ya encolados en el
-- celular de un juez entren solos en el proximo reintento. El cliente ademas
-- redondea antes de guardar, asi los nuevos ya salen enteros.

create or replace function public.ingest_timing_events(p_events jsonb)
returns table (event_id uuid, accepted boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_lane_id uuid;
  v_lane_event uuid;
  v_lane_heat uuid;
  v_lane_judge uuid;
  v_id uuid;
  v_capturado timestamptz;
  v_elapsed int;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Se esperaba un arreglo de eventos';
  end if;

  for v_row in select value from jsonb_array_elements(p_events) as t(value)
  loop
    v_id := (v_row ->> 'id')::uuid;
    v_lane_id := (v_row ->> 'laneId')::uuid;

    select l.event_id, l.heat_id, l.judge_id
      into v_lane_event, v_lane_heat, v_lane_judge
    from public.lanes l
    where l.id = v_lane_id;

    if v_lane_event is null then
      raise exception 'El carril % no existe', v_lane_id;
    end if;

    -- El carril tomado por un juez no acepta marcajes de otro. La organizacion
    -- y el head judge si pueden, para poder corregir en caliente.
    if v_lane_judge is distinct from auth.uid()
       and not public.can_verify_event(v_lane_event) then
      raise exception 'El carril está asignado a otro juez'
        using errcode = 'insufficient_privilege';
    end if;

    -- Via numeric: aguanta enteros y decimales por igual.
    v_elapsed := round((v_row ->> 'elapsedMs')::numeric)::int;

    if v_elapsed < 0 then
      raise exception 'elapsedMs no puede ser negativo (%)', v_elapsed;
    end if;

    -- Numero = epoch en milisegundos (Date.now()). Texto = ISO. Los dos valen:
    -- este campo es informativo para auditoria y jamas se usa para rankear, asi
    -- que un formato raro no puede tirar abajo un marcaje.
    v_capturado := case
      when jsonb_typeof(v_row -> 'clientCapturedAt') = 'number'
        then to_timestamp((v_row ->> 'clientCapturedAt')::numeric / 1000.0)
      when coalesce(v_row ->> 'clientCapturedAt', '') = ''
        then null
      else (v_row ->> 'clientCapturedAt')::timestamptz
    end;

    insert into public.timing_events (
      id, lane_id, heat_id, event_id, seq, type, segment_id, elapsed_ms,
      payload, recorded_by, device_id, client_captured_at, supersedes_id
    )
    values (
      v_id,
      v_lane_id,
      v_lane_heat,
      v_lane_event,
      round((v_row ->> 'seq')::numeric)::int,
      (v_row ->> 'type')::public.timing_event_type,
      nullif(v_row ->> 'segmentId', '')::uuid,
      v_elapsed,
      coalesce(v_row -> 'payload', '{}'::jsonb),
      auth.uid(),
      nullif(v_row ->> 'deviceId', ''),
      v_capturado,
      nullif(v_row ->> 'supersedesId', '')::uuid
    )
    on conflict (id) do nothing;

    event_id := v_id;
    accepted := found;
    return next;
  end loop;
end;
$$;

select public.apply_function_lockdown();
