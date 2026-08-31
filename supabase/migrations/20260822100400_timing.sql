-- El log de marcajes y los resultados derivados.
--
-- timing_events es la fuente de verdad de todo el producto. Es append-only: el
-- rol `authenticated` recibe select e insert, y NO recibe update ni delete. Eso
-- no es una convencion de la app, es un privilegio que Postgres no otorga. Un
-- juez no puede alterar un tiempo ni aunque quiera.
--
-- Anular un marcaje es una operacion privilegiada y auditada: pasa por
-- void_timing_event(), que solo acepta head judge u organizacion.

create type public.timing_event_type as enum (
  'lane_start',
  'segment_split',
  'penalty',
  'undo',
  'dnf',
  'dq',
  'note'
);

create table public.timing_events (
  -- Sin default a proposito: el id lo genera el CLIENTE antes de tocar la red.
  -- Es la clave de idempotencia que hace que reenviar un lote sea inofensivo.
  id uuid primary key,
  lane_id uuid not null,
  heat_id uuid not null,
  event_id uuid not null,
  -- Orden local del dispositivo. Desempata marcajes con el mismo elapsed.
  seq int not null check (seq > 0),
  type public.timing_event_type not null,
  segment_id uuid,
  -- Milisegundos desde la largada del heat. Nunca reloj de pared.
  elapsed_ms int not null check (elapsed_ms >= 0),
  payload jsonb not null default '{}'::jsonb,
  recorded_by uuid not null references auth.users (id) on delete restrict,
  device_id text,
  -- Reloj de pared del dispositivo. Informativo, para auditoria. Jamas se usa
  -- para rankear: puede estar mal y no importa.
  client_captured_at timestamptz,
  server_received_at timestamptz not null default now(),
  supersedes_id uuid references public.timing_events (id) on delete restrict,
  voided boolean not null default false,
  void_reason text,
  voided_by uuid references auth.users (id) on delete set null,
  voided_at timestamptz,
  foreign key (lane_id, event_id) references public.lanes (id, event_id) on delete cascade,
  foreign key (heat_id, event_id) references public.heats (id, event_id) on delete cascade,
  foreign key (segment_id, event_id) references public.segments (id, event_id) on delete set null,
  constraint timing_events_void_needs_reason check (
    voided = false or (void_reason is not null and voided_by is not null)
  )
);

create index timing_events_lane_idx on public.timing_events (lane_id, seq);
create index timing_events_event_idx on public.timing_events (event_id, server_received_at);
create unique index timing_events_lane_seq_unique
  on public.timing_events (lane_id, device_id, seq)
  where device_id is not null;

-- ---------------------------------------------------------------------------
-- Ingesta
-- ---------------------------------------------------------------------------

-- Recibe el lote que el juez tenia en la cola local.
--
-- Dos garantias:
--   1. Idempotencia: `on conflict (id) do nothing`. El mismo lote mil veces
--      deja exactamente los mismos registros.
--   2. Autoria no falsificable: recorded_by sale de auth.uid(), nunca del
--      payload del cliente.
--
-- Acepta las claves en camelCase para que el cliente pueda mandar su objeto de
-- dominio tal cual, sin una capa de mapeo que se pueda desincronizar.
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
      nullif(v_row ->> 'clientCapturedAt', '')::timestamptz,
      nullif(v_row ->> 'supersedesId', '')::uuid
    )
    on conflict (id) do nothing;

    event_id := v_id;
    accepted := found;
    return next;
  end loop;
end;
$$;

-- Anula un marcaje ya registrado. No lo borra: el log sigue completo y el
-- reductor simplemente deja de contarlo.
create or replace function public.void_timing_event(
  p_timing_event_id uuid,
  p_reason text
)
returns public.timing_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.timing_events;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'Anular un marcaje exige un motivo';
  end if;

  select * into v_row from public.timing_events where id = p_timing_event_id;

  if v_row.id is null then
    raise exception 'El marcaje no existe';
  end if;

  if not public.can_verify_event(v_row.event_id) then
    raise exception 'Solo el juez principal o la organización pueden anular un marcaje'
      using errcode = 'insufficient_privilege';
  end if;

  update public.timing_events
  set voided = true,
      void_reason = p_reason,
      voided_by = auth.uid(),
      voided_at = now()
  where id = p_timing_event_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Resultados derivados
-- ---------------------------------------------------------------------------
--
-- Esta tabla es CACHE, no logica. El calculo vive en una sola funcion pura de
-- TypeScript (src/shared/timing/reducer.ts) que corre igual en el cliente y en
-- el servidor. Reimplementar el reductor en SQL seria garantizar que algun dia
-- el tiempo en vivo y el oficial no coincidan.
--
-- Deliberadamente NO se guarda la posicion: el ranking se deriva al leer. Una
-- posicion almacenada es un dato mas que puede quedar desactualizado.

create table public.results (
  lane_id uuid primary key,
  event_id uuid not null,
  heat_id uuid not null,
  team_id uuid,
  division_id uuid,
  status public.lane_status not null,
  raw_ms int,
  penalty_ms int not null default 0,
  total_ms int,
  stopped_at_ms int,
  splits jsonb not null default '[]'::jsonb,
  anomalies jsonb not null default '[]'::jsonb,
  -- Cuantos eventos del log se usaron. Permite detectar un cache viejo.
  source_event_count int not null default 0,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (lane_id, event_id) references public.lanes (id, event_id) on delete cascade
);

create index results_division_idx on public.results (division_id, total_ms);
create index results_event_idx on public.results (event_id);

create table public.result_publications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  division_id uuid,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null,
  -- Congelado a proposito: una vez publicado, el oficial no se mueve aunque
  -- despues cambie algo en results.
  snapshot jsonb not null,
  unique (event_id, division_id, published_at)
);

-- ---------------------------------------------------------------------------
-- Leaderboard publico
-- ---------------------------------------------------------------------------

-- Los anonimos no reciben permisos sobre ninguna tabla. El acceso publico pasa
-- solo por esta funcion, que expone exactamente lo que el atleta necesita ver y
-- nada mas: sin emails, sin telefonos, sin datos de otros eventos.
create or replace function public.public_leaderboard(p_public_slug text)
returns table (
  division_name text,
  bib_number int,
  team_name text,
  athletes text,
  status public.lane_status,
  total_ms int,
  penalty_ms int,
  splits jsonb,
  rank_position bigint,
  official boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    d.name as division_name,
    t.bib_number,
    t.name as team_name,
    (
      select string_agg(a.first_name || ' ' || a.last_name, ' / ' order by a.last_name)
      from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
    ) as athletes,
    r.status,
    r.total_ms,
    r.penalty_ms,
    r.splits,
    rank() over (
      partition by r.division_id
      order by
        case r.status when 'finished' then 0 when 'running' then 1 else 2 end,
        r.total_ms nulls last
    ) as rank_position,
    (e.status = 'published') as official
  from public.events e
  join public.results r on r.event_id = e.id
  join public.teams t on t.id = r.team_id
  join public.divisions d on d.id = r.division_id
  where e.public_slug = p_public_slug
    -- Un evento en borrador o listo todavia no muestra nada al publico.
    and e.status in ('live', 'verifying', 'published');
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.timing_events enable row level security;
alter table public.results enable row level security;
alter table public.result_publications enable row level security;

create policy timing_events_read on public.timing_events
  for select using (public.event_role(event_id) is not null);

-- El juez inserta solo en su propio carril, y solo firmando con su identidad.
-- La ruta normal es ingest_timing_events(), pero la politica tiene que sostener
-- la garantia por si alguien inserta directo contra la tabla.
create policy timing_events_insert on public.timing_events
  for insert with check (
    recorded_by = auth.uid()
    and (
      exists (
        select 1 from public.lanes l
        where l.id = lane_id and l.judge_id = auth.uid()
      )
      or public.can_verify_event(event_id)
    )
  );

create policy results_read on public.results
  for select using (public.event_role(event_id) is not null);
create policy results_write on public.results
  for all using (public.can_verify_event(event_id))
  with check (public.can_verify_event(event_id));

create policy result_publications_read on public.result_publications
  for select using (public.event_role(event_id) is not null);
create policy result_publications_write on public.result_publications
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

-- Aca esta la garantia de inmutabilidad, y es un GRANT, no una politica:
-- update y delete simplemente no se otorgan.
grant select, insert on public.timing_events to authenticated;

grant select, insert, update, delete on public.results to authenticated;
grant select, insert, update, delete on public.result_publications to authenticated;

grant execute on function public.ingest_timing_events(jsonb) to authenticated;
grant execute on function public.void_timing_event(uuid, text) to authenticated;
grant execute on function public.public_leaderboard(text) to anon, authenticated;
