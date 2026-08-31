-- La ingesta acepta clientCapturedAt en epoch milisegundos.
--
-- QUE PASABA
--
-- El cliente estampa `clientCapturedAt: Date.now()`, o sea un numero. La funcion
-- hacia `(v_row ->> 'clientCapturedAt')::timestamptz` sobre ese numero y Postgres
-- respondia:
--
--     date/time field value out of range: "1787448478979"
--
-- La excepcion abortaba el lote entero. Cada intento de sincronizar fallaba, la
-- cola local crecia, y el juez veia "17 sin sincronizar" sin ningun mensaje de
-- error: el reintento con backoff simplemente seguia fallando en silencio.
--
-- Los tests no lo detectaron porque el fixture mandaba ISO string, que si casteaba
-- bien. El formato del fixture no coincidia con el del cliente real.
--
-- Se arregla del lado del SERVIDOR y no del cliente a proposito: los marcajes que
-- ya estan encolados en el celular de un juez tienen el formato viejo. Arreglando
-- aca, entran solos en el proximo reintento, sin necesidad de que el juez
-- actualice la app en medio de una competencia.

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
      (v_row ->> 'seq')::int,
      (v_row ->> 'type')::public.timing_event_type,
      nullif(v_row ->> 'segmentId', '')::uuid,
      (v_row ->> 'elapsedMs')::int,
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
