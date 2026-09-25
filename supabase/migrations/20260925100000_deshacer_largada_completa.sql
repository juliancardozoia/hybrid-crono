-- Deshacer la largada de un heat, aunque los jueces ya hayan entrado o marcado.
--
-- QUE FALLABA
--
-- `cancel_heat_start` exigia CERO filas en `timing_events` para el heat. Pero el
-- celular del juez escribe un `lane_start` (elapsedMs = 0, sin payload) apenas
-- ancla el reloj, sin que el juez toque nada -- y los jueces abren el
-- cronometro ANTES de la largada, que es justo como esta pensada la app. Asi el
-- boton "Deshacer Inicio" quedaba bloqueado en el caso mas comun en que hace
-- falta: la organizacion larga por error con un juez esperando.
--
-- LO QUE SE ARREGLA, EN TRES PIEZAS
--
-- 1) El guard de `cancel_heat_start` cuenta marcajes ACTIVOS de datos reales:
--    no cuenta `lane_start` (marcador sintetico), `undo` (contabilidad), lo ya
--    anulado (`voided`) ni lo ya reemplazado por un `undo` (`supersedes_id`).
--    Es exactamente el criterio con que el reductor arma su lista de eventos
--    activos, asi que "no hay nada que perder" significa lo mismo en los dos.
--
-- 2) `deshacer_largada_completa` es el camino con marcajes reales de por medio:
--    anula TODOS los del heat con UN motivo, y despues delega en
--    `cancel_heat_start`. Nada se borra: `voided` + motivo + quien + cuando.
--
-- 3) `start_generation`: de que "largada" es cada marcaje. Sin esto, un tap
--    que quedo atrapado en el celular de un juez sin señal llegaria horas
--    despues -cuando el MISMO heat ya volvio a largar- y se mezclaria con la
--    carrera nueva como si fuera suya (el heat conserva su id y sus carriles
--    al deshacer, asi que el servidor no tiene otra forma de distinguirlos).
--
--    La generacion sube cada vez que se deshace una largada. La estampa el
--    CELULAR (la lee de su ancla) y no el servidor: si la estampara el servidor
--    al insertar, el tap atrasado llegaria "con la generacion nueva" y se
--    colaria igual. El servidor solo la acota a [0, generacion actual].
--
--    Los marcajes de una generacion vieja SE GUARDAN igual (el log es
--    append-only y un tiempo no se pierde), pero nadie que arme un resultado
--    los cuenta: ver `recompute.ts`, `judge_lane_events` y `verification_queue`.

alter table public.heats
  add column start_generation int not null default 0;

alter table public.timing_events
  add column start_generation int not null default 0;

-- ---------------------------------------------------------------------------
-- La ingesta estampa la generacion que declara el celular.
-- ---------------------------------------------------------------------------
-- Si el marcaje no la trae (un dispositivo con la app vieja en cache, o la
-- organizacion marcando DNF desde el panel) se asume la vigente: es la unica
-- respuesta sensata para quien no sabe de generaciones, y para el panel es la
-- correcta, porque marca sobre la largada que esta mirando.
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
  v_heat_generation int;
  v_generation int;
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

    select l.event_id, l.heat_id, l.judge_id, h.start_generation
      into v_lane_event, v_lane_heat, v_lane_judge, v_heat_generation
    from public.lanes l
    join public.heats h on h.id = l.heat_id
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

    -- Acotada: una generacion mayor a la vigente no puede existir de verdad, y
    -- dejarla pasar la volveria invisible (los lectores comparan por igualdad).
    v_generation := least(
      greatest(
        coalesce(round(nullif(v_row ->> 'startGeneration', '')::numeric)::int, v_heat_generation),
        0
      ),
      v_heat_generation
    );

    insert into public.timing_events (
      id, lane_id, heat_id, event_id, seq, type, segment_id, elapsed_ms,
      payload, recorded_by, device_id, client_captured_at, supersedes_id,
      start_generation
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
      nullif(v_row ->> 'supersedesId', '')::uuid,
      v_generation
    )
    on conflict (id) do nothing;

    event_id := v_id;
    accepted := found;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_heat_start: solo bloquea lo que de verdad seria perder un tiempo.
-- ---------------------------------------------------------------------------
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

  -- Misma definicion de "activo" que `reduceLaneEvents`: sin anulados, sin los
  -- reemplazados por un `undo` (aunque ese `undo` este anulado: el reductor
  -- tampoco lo mira), y sin `lane_start`/`undo`, que no llevan ningun dato.
  select count(*) into v_marcajes
  from public.timing_events te
  where te.heat_id = p_heat_id
    and te.start_generation = v_heat.start_generation
    and not te.voided
    and te.type not in ('lane_start', 'undo')
    and not exists (select 1 from public.timing_events u where u.supersedes_id = te.id);

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

-- ---------------------------------------------------------------------------
-- deshacer_largada_completa: la salida cuando ya hay marcajes reales.
-- ---------------------------------------------------------------------------
-- Devuelve cuantos marcajes REALES anulo (no cuenta `lane_start` ni `undo`).
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

  select count(*) into v_reales
  from public.timing_events te
  where te.heat_id = p_heat_id
    and te.start_generation = v_heat.start_generation
    and not te.voided
    and te.type not in ('lane_start', 'undo')
    and not exists (select 1 from public.timing_events u where u.supersedes_id = te.id);

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

-- ---------------------------------------------------------------------------
-- Los lectores cuentan solo la largada vigente.
-- ---------------------------------------------------------------------------
create or replace function public.judge_lane_events(p_lane_id uuid)
returns setof public.timing_events
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select te.*
  from public.timing_events te
  join public.lanes l on l.id = te.lane_id
  join public.heats h on h.id = l.heat_id
  where te.lane_id = p_lane_id
    and te.start_generation = h.start_generation
    and (public.event_role(l.event_id) is not null or public.event_staff_role(l.event_id) is not null)
  order by te.seq;
$$;

create or replace function public.verification_queue(p_event_id uuid)
returns table (
  lane_id uuid,
  bib_number int,
  division_name text,
  heat_name text,
  status public.lane_status,
  total_ms int,
  verified boolean,
  event_count int,
  voided_count int,
  anomalies jsonb,
  started_offline boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.id,
    t.bib_number,
    d.name,
    h.name,
    coalesce(r.status, w.status, l.status),
    r.total_ms,
    (r.verified_at is not null),
    coalesce(
      r.source_event_count,
      (select count(*)::int from public.timing_events te
       where te.lane_id = l.id and te.start_generation = h.start_generation)
    ),
    (select count(*)::int from public.timing_events te
     where te.lane_id = l.id and te.voided and te.start_generation = h.start_generation),
    coalesce(r.anomalies, '[]'::jsonb),
    (h.start_source = 'device_offline')
  from public.lanes l
  join public.heats h on h.id = l.heat_id
  left join public.teams t on t.id = l.team_id
  left join public.divisions d on d.id = t.division_id
  left join public.results r on r.lane_id = l.id
  left join lateral (
    select
      (case
        when bool_or(ws.status = 'dq') then 'dq'
        when bool_or(ws.status = 'dnf') then 'dnf'
        when count(*) filter (where ws.status not in ('valido', 'capeado')) = 0 then 'finished'
        when bool_or(ws.status in ('en_curso', 'valido', 'capeado')) then 'running'
        else 'idle'
      end)::public.lane_status as status
    from public.workout_scores ws
    where ws.lane_id = l.id
    having count(*) > 0
  ) w on true
  where l.event_id = p_event_id
    and l.team_id is not null
    and public.can_verify_event(p_event_id)
  order by d.name, t.bib_number;
$$;

select public.apply_function_lockdown();
