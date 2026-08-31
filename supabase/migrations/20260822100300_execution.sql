-- Ejecucion: heats, carriles y el bloqueo de juez.
--
-- Aca vive una de las decisiones que sostienen el producto: que dos jueces no
-- puedan tomar el mismo carril. Se resuelve en Postgres con un UPDATE
-- condicional, no en el cliente, porque el cliente no puede ganar una carrera
-- contra otro cliente.

create type public.heat_status as enum ('scheduled', 'armed', 'running', 'finished');

create type public.start_source as enum (
  'server',         -- la largada la estampo el servidor: hora confiable
  'device_offline'  -- el heat arranco sin senal, la estampo un dispositivo
);

create type public.lane_status as enum ('idle', 'running', 'finished', 'dnf', 'dq');

create table public.heats (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Opcional: un heat puede mezclar divisiones si el evento es chico.
  division_id uuid,
  name text not null check (length(trim(name)) > 0),
  scheduled_at timestamptz,
  lane_count int not null default 6 check (lane_count between 1 and 32),
  status public.heat_status not null default 'scheduled',
  started_at timestamptz,
  started_by uuid references auth.users (id) on delete set null,
  start_source public.start_source,
  created_at timestamptz not null default now(),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete set null,
  unique (event_id, name),
  unique (id, event_id),
  -- Un heat corriendo o terminado tiene que tener largada. Sin esto, un bug de
  -- la app podria dejar carriles cronometrando contra un ancla inexistente.
  constraint heats_running_needs_start check (
    status not in ('running', 'finished') or started_at is not null
  ),
  constraint heats_start_needs_source check (
    (started_at is null) = (start_source is null)
  )
);

create index heats_event_idx on public.heats (event_id, scheduled_at);

create table public.lanes (
  id uuid primary key default gen_random_uuid(),
  heat_id uuid not null,
  event_id uuid not null,
  lane_number int not null check (lane_number > 0),
  team_id uuid,
  -- 0 en largada masiva. Deja lista la largada escalonada sin cambiar nada mas.
  start_offset_ms int not null default 0 check (start_offset_ms >= 0),
  judge_id uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  status public.lane_status not null default 'idle',
  created_at timestamptz not null default now(),
  foreign key (heat_id, event_id) references public.heats (id, event_id) on delete cascade,
  foreign key (team_id, event_id) references public.teams (id, event_id) on delete set null,
  unique (heat_id, lane_number),
  unique (id, event_id)
);

-- Un equipo corre una sola vez en todo el evento. Si aparece dos veces es un
-- error de armado de heats, y es mucho mejor que reviente al asignarlo que
-- descubrirlo cuando hay dos tiempos para el mismo dorsal.
create unique index lanes_team_once_per_event
  on public.lanes (event_id, team_id)
  where team_id is not null;

create index lanes_judge_idx on public.lanes (judge_id) where judge_id is not null;

-- Rastro de quien tomo, solto o transfirio cada carril. Cuando un resultado se
-- discute, esto es lo que responde "quien estaba a cargo".
create table public.lane_audit (
  id uuid primary key default gen_random_uuid(),
  lane_id uuid not null references public.lanes (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  action text not null check (action in ('claim', 'release', 'transfer')),
  actor_id uuid references auth.users (id) on delete set null,
  previous_judge_id uuid references auth.users (id) on delete set null,
  new_judge_id uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create index lane_audit_lane_idx on public.lane_audit (lane_id, created_at);

-- ---------------------------------------------------------------------------
-- Largada del heat
-- ---------------------------------------------------------------------------

-- Estampa la largada oficial. Es idempotente a proposito: si el heat ya
-- arranco, devuelve la largada existente sin tocarla. Un doble tap en el boton
-- de largada nunca puede reiniciar el reloj de seis atletas en carrera.
create or replace function public.start_heat(p_heat_id uuid)
returns public.heats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_heat public.heats;
begin
  select * into v_heat from public.heats where id = p_heat_id;

  if v_heat.id is null then
    raise exception 'El heat no existe';
  end if;

  if not public.can_verify_event(v_heat.event_id) then
    raise exception 'No tienes permiso para iniciar este heat'
      using errcode = 'insufficient_privilege';
  end if;

  if v_heat.started_at is not null then
    return v_heat;
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

-- ---------------------------------------------------------------------------
-- Bloqueo de carril
-- ---------------------------------------------------------------------------

-- Toma un carril para el juez actual.
--
-- El UPDATE condicional es el corazon: bajo concurrencia, Postgres bloquea la
-- fila y el segundo UPDATE reevalua el WHERE contra la version ya modificada.
-- Si otro juez gano, la condicion deja de cumplirse y no afecta ninguna fila.
-- No hay ventana entre "verificar" y "tomar" porque son la misma operacion.
--
-- SECURITY DEFINER a proposito: es la UNICA via por la que un juez puede tocar
-- lanes.judge_id. La tabla no le otorga update, asi que no puede reasignar
-- carriles por su cuenta ni robarle uno a un companero.
create or replace function public.claim_lane(
  p_lane_id uuid,
  p_lease_minutes int default 360
)
returns public.lanes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lane public.lanes;
  v_event_id uuid;
  v_previous uuid;
begin
  select event_id, judge_id into v_event_id, v_previous
  from public.lanes where id = p_lane_id;

  if v_event_id is null then
    raise exception 'El carril no existe';
  end if;

  if public.event_role(v_event_id) is null then
    raise exception 'No perteneces a este evento'
      using errcode = 'insufficient_privilege';
  end if;

  update public.lanes
  set judge_id = auth.uid(),
      claimed_at = now(),
      lease_expires_at = now() + make_interval(mins => p_lease_minutes)
  where id = p_lane_id
    and (
      judge_id is null                 -- libre
      or judge_id = auth.uid()         -- ya es mio: reclamar de nuevo es inofensivo
      or lease_expires_at < now()      -- el juez anterior lo abandono
    )
  returning * into v_lane;

  if v_lane.id is null then
    raise exception 'El carril ya lo tomó otro juez'
      using errcode = 'lock_not_available';
  end if;

  -- Solo se audita el cambio de manos, no cada renovacion del propio juez.
  if v_previous is distinct from auth.uid() then
    insert into public.lane_audit (lane_id, event_id, action, actor_id, previous_judge_id, new_judge_id)
    values (p_lane_id, v_event_id, 'claim', auth.uid(), v_previous, auth.uid());
  end if;

  return v_lane;
end;
$$;

-- Transfiere un carril a otro juez. Es la salida cuando a un juez se le muere
-- el celular en medio de la carrera. Solo head judge u organizador.
create or replace function public.transfer_lane(
  p_lane_id uuid,
  p_to_judge uuid,
  p_reason text default null
)
returns public.lanes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lane public.lanes;
  v_event_id uuid;
  v_previous uuid;
begin
  select event_id, judge_id into v_event_id, v_previous
  from public.lanes where id = p_lane_id;

  if v_event_id is null then
    raise exception 'El carril no existe';
  end if;

  if not public.can_verify_event(v_event_id) then
    raise exception 'Solo el juez principal o la organización pueden transferir un carril'
      using errcode = 'insufficient_privilege';
  end if;

  -- No se puede transferir un carril a alguien ajeno a la organizacion: seria
  -- darle acceso de escritura a los tiempos por la puerta de atras.
  if p_to_judge is not null and not exists (
    select 1
    from public.org_members m
    join public.events e on e.org_id = m.org_id
    where e.id = v_event_id and m.user_id = p_to_judge
  ) then
    raise exception 'El juez destino no pertenece a la organización del evento';
  end if;

  update public.lanes
  set judge_id = p_to_judge,
      claimed_at = case when p_to_judge is null then null else now() end,
      lease_expires_at = case when p_to_judge is null then null else now() + interval '6 hours' end
  where id = p_lane_id
  returning * into v_lane;

  insert into public.lane_audit (
    lane_id, event_id, action, actor_id, previous_judge_id, new_judge_id, reason
  )
  values (
    p_lane_id, v_event_id,
    case when p_to_judge is null then 'release' else 'transfer' end,
    auth.uid(), v_previous, p_to_judge, p_reason
  );

  return v_lane;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.heats enable row level security;
alter table public.lanes enable row level security;
alter table public.lane_audit enable row level security;

create policy heats_read on public.heats
  for select using (public.event_role(event_id) is not null);
create policy heats_write on public.heats
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

-- El juez lee todos los carriles de su evento (necesita ver cual tomar), pero
-- no escribe ninguno: judge_id solo se toca via claim_lane / transfer_lane.
create policy lanes_read on public.lanes
  for select using (public.event_role(event_id) is not null);
create policy lanes_write on public.lanes
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

create policy lane_audit_read on public.lane_audit
  for select using (public.event_role(event_id) is not null);

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.heats to authenticated;
grant select, insert, update, delete on public.lanes to authenticated;
-- lane_audit es solo lectura para todos: lo escriben las funciones definer.
grant select on public.lane_audit to authenticated;

grant execute on function public.start_heat(uuid) to authenticated;
grant execute on function public.claim_lane(uuid, int) to authenticated;
grant execute on function public.transfer_lane(uuid, uuid, text) to authenticated;
