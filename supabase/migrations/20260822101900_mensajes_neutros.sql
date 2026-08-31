-- Mensajes de las funciones en espanol neutro.
--
-- POR QUE ESTA MIGRACION EXISTE
--
-- Los mensajes que estas funciones le muestran al usuario pasaron de voseo
-- rioplatense a espanol neutro: "no tenes permiso" -> "no tienes permiso",
-- "el carril ya lo tomo otro juez" -> "ya lo tomo otro juez" con tilde, "dueno"
-- -> "dueno" con enie.
--
-- Editar las migraciones viejas no alcanza: Supabase no vuelve a correr una
-- migracion ya aplicada, asi que una base nueva quedaria con el texto corregido
-- y la de produccion seguiria con el viejo. Esta migracion redefine las
-- funciones para que las dos terminen iguales.
--
-- Generada por scripts/regenerar-funciones.mjs a partir de la ultima definicion
-- de cada funcion, para no re-escribirlas a mano y arriesgar divergencias.

create or replace function public.reorder_segments(
  p_template_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_total int;
  v_recibidos int;
  i int;
begin
  select event_id into v_event_id
  from public.course_templates
  where id = p_template_id;

  if v_event_id is null then
    raise exception 'La plantilla de circuito no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para editar este circuito'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_total
  from public.segments where course_template_id = p_template_id;

  v_recibidos := coalesce(array_length(p_ordered_ids, 1), 0);

  -- Una lista incompleta dejaria segmentos con indices basura. Mejor rechazarla
  -- entera que aplicar un reordenamiento a medias.
  if v_recibidos <> v_total then
    raise exception 'La lista tiene % segmentos y el circuito tiene %', v_recibidos, v_total;
  end if;

  update public.segments
  set order_index = order_index + 100000
  where course_template_id = p_template_id;

  for i in 1..v_recibidos loop
    update public.segments
    set order_index = i - 1
    where id = p_ordered_ids[i]
      and course_template_id = p_template_id;
  end loop;

  if exists (
    select 1 from public.segments
    where course_template_id = p_template_id and order_index >= 100000
  ) then
    raise exception 'La lista de orden no corresponde a los segmentos del circuito';
  end if;
end;
$$;

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

create or replace function public.verify_results(
  p_event_id uuid,
  p_division_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cantidad int;
begin
  if not public.can_verify_event(p_event_id) then
    raise exception 'Solo el juez principal o la organización pueden verificar resultados'
      using errcode = 'insufficient_privilege';
  end if;

  update public.results
  set verified_by = auth.uid(),
      verified_at = now()
  where event_id = p_event_id
    and (p_division_id is null or division_id = p_division_id);

  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

create or replace function public.publish_results(
  p_event_id uuid,
  p_division_id uuid default null
)
returns public.result_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_row public.result_publications;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Solo la organización puede publicar resultados'
      using errcode = 'insufficient_privilege';
  end if;

  with rankeado as (
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
      r.raw_ms,
      r.penalty_ms,
      r.total_ms,
      r.splits,
      rank() over (
        partition by r.division_id
        order by
          case r.status when 'finished' then 0 else 1 end,
          r.total_ms nulls last
      ) as rank_position
    from public.results r
    join public.teams t on t.id = r.team_id
    join public.divisions d on d.id = r.division_id
    where r.event_id = p_event_id
      and (p_division_id is null or r.division_id = p_division_id)
  )
  select jsonb_agg(to_jsonb(rankeado) order by division_name, rank_position)
  into v_snapshot
  from rankeado;

  insert into public.result_publications (event_id, division_id, published_by, snapshot)
  values (p_event_id, p_division_id, auth.uid(), coalesce(v_snapshot, '[]'::jsonb))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.invite_to_org(
  p_org_id uuid,
  p_email text,
  p_role public.org_role default 'judge'
)
returns table (estado text, detalle text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_user_id uuid;
begin
  if not public.can_admin_org(p_org_id) then
    raise exception 'Solo el dueño o un administrador pueden invitar'
      using errcode = 'insufficient_privilege';
  end if;

  if position('@' in v_email) < 2 then
    raise exception 'Email inválido';
  end if;

  -- Nadie se asciende a si mismo invitandose de nuevo con otro rol.
  if p_role = 'owner' and not public.is_org_owner(p_org_id) then
    raise exception 'Solo el dueño puede nombrar a otro dueño'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_user_id from auth.users where lower(email) = v_email;

  if v_user_id is not null then
    -- Ya tiene cuenta: entra directo, sin pasar por la invitacion.
    insert into public.org_members (org_id, user_id, role)
    values (p_org_id, v_user_id, p_role)
    on conflict (org_id, user_id) do update set role = excluded.role;

    estado := 'agregado';
    detalle := 'Ya tenia cuenta: quedo dentro de la organizacion.';
    return next;
    return;
  end if;

  insert into public.org_invitations (org_id, email, role, invited_by)
  values (p_org_id, v_email, p_role, auth.uid())
  on conflict (org_id, email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        created_at = now();

  estado := 'invitado';
  detalle := 'Todavia no tiene cuenta. Entra sola cuando se registre con ese email.';
  return next;
end;
$$;

create or replace function public.remove_org_member(p_org_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duenos int;
begin
  if not public.can_admin_org(p_org_id) then
    raise exception 'Solo el dueño o un administrador pueden quitar miembros'
      using errcode = 'insufficient_privilege';
  end if;

  -- Una organizacion sin dueno queda sin nadie que pueda administrarla.
  select count(*) into v_duenos
  from public.org_members
  where org_id = p_org_id and role = 'owner';

  if v_duenos = 1 and exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = p_user_id and role = 'owner'
  ) then
    raise exception 'Es el único dueño de la organización: nombra a otro antes de quitarlo';
  end if;

  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;
end;
$$;

select public.apply_function_lockdown();
