-- "Pendiente" en el alta manual dejaba de existir para /atletas: la
-- migracion anterior no creaba equipo ninguno hasta que se aprobara desde
-- Inscripciones, asi que un atleta recien cargado como pendiente
-- desaparecia de la grilla en vez de mostrarse. Reportado al usarlo: TODO
-- atleta que se crea tiene que verse en /atletas desde el primer momento,
-- con un toggle ahi mismo para aprobarlo -- lo unico que hay que conservar
-- es que un equipo no aprobado no puede terminar en ningun heat.
--
-- La solucion es una bandera en `teams`, no un estado mas del tramite de
-- inscripcion: `approved` es una decision operativa de la organizacion
-- (verificar el pago, verificar que la persona es quien dice ser) separada
-- de `registrations.status`, que sigue significando "el TRAMITE llego a
-- buen puerto". El alta manual con estado 'pendiente' ahora SIEMPRE
-- materializa el equipo (como 'aprobado'), solo que con `approved = false`.

alter table public.teams add column approved boolean not null default true;

-- `admin_create_registration` ya no salta `confirm_registration()` cuando
-- el estado es 'pendiente': crea el equipo siempre, y solo despues lo marca
-- sin aprobar. Mismos 4 parametros que la version anterior -- no hace falta
-- un drop por aridad esta vez.
create or replace function public.admin_create_registration(
  p_division_id uuid,
  p_team_name text,
  p_integrantes jsonb,
  p_estado text default 'aprobado'
)
returns public.teams
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_division public.divisions;
  v_evento public.events;
  v_registro public.registrations;
  v_precio public.division_registration;
  v_integrante jsonb;
  v_talla text;
  v_posicion int := 0;
  v_equipo public.teams;
begin
  if p_estado not in ('aprobado', 'pendiente') then
    raise exception 'Estado de registro inválido: %', p_estado;
  end if;

  select * into v_division from public.divisions where id = p_division_id;
  if not found then
    raise exception 'La categoría no existe';
  end if;

  if not coalesce(public.can_register_event(v_division.event_id), false) then
    raise exception 'No tenés permiso para registrar atletas en esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_evento from public.events where id = v_division.event_id;

  if p_integrantes is null or jsonb_array_length(p_integrantes) <> v_division.team_size then
    raise exception 'Esta categoría es de % integrante(s)', v_division.team_size;
  end if;

  select * into v_precio from public.division_registration where division_id = p_division_id;

  insert into public.registrations (
    event_id, division_id, created_by, status, team_name, price_cents, currency
  )
  values (
    v_division.event_id, p_division_id, auth.uid(), 'borrador'::public.registration_status,
    nullif(trim(coalesce(p_team_name, '')), ''),
    v_precio.price_cents, coalesce(v_precio.currency, 'COP')
  )
  returning * into v_registro;

  for v_integrante in select * from jsonb_array_elements(p_integrantes)
  loop
    v_posicion := v_posicion + 1;

    if nullif(trim(coalesce(v_integrante ->> 'email', '')), '') is null then
      raise exception 'Cada integrante necesita un correo';
    end if;

    -- Misma validacion que save_member_data: la talla tiene que ser una de
    -- las que ofrece el evento, si el evento ofrece alguna.
    v_talla := nullif(trim(coalesce(v_integrante ->> 'shirtSize', '')), '');
    if v_talla is not null
       and array_length(v_evento.shirt_sizes, 1) is not null
       and not (v_talla = any (v_evento.shirt_sizes)) then
      raise exception 'La talla % no es una de las que ofrece esta competencia', v_talla;
    end if;

    insert into public.registration_members (
      registration_id, event_id, position, invited_email,
      first_name, last_name, birth_date, gender, phone,
      country, document_id, state_province, box, shirt_size,
      status, accepted_terms_at
    )
    values (
      v_registro.id, v_division.event_id, v_posicion,
      lower(trim(v_integrante ->> 'email')),
      nullif(trim(coalesce(v_integrante ->> 'firstName', '')), ''),
      nullif(trim(coalesce(v_integrante ->> 'lastName', '')), ''),
      nullif(v_integrante ->> 'birthDate', '')::date,
      nullif(v_integrante ->> 'gender', '')::public.athlete_gender,
      nullif(trim(coalesce(v_integrante ->> 'phone', '')), ''),
      upper(nullif(trim(coalesce(v_integrante ->> 'country', '')), '')),
      nullif(trim(coalesce(v_integrante ->> 'documentId', '')), ''),
      nullif(trim(coalesce(v_integrante ->> 'stateProvince', '')), ''),
      nullif(trim(coalesce(v_integrante ->> 'box', '')), ''),
      v_talla,
      -- 'completo' de una: el organizador ya tiene los datos, no hay a quien
      -- esperar. `accepted_terms_at` se marca porque `confirm_registration` no
      -- exige status='completo' sin ella (misma regla que `save_member_data`),
      -- y aca es la organizacion la que da fe del alta, no un formulario propio.
      'completo'::public.registration_member_status, now()
    );
  end loop;

  -- Se materializa SIEMPRE, aprobado o pendiente: todo atleta que se crea
  -- tiene que verse en /atletas desde el primer momento. Lo que cambia con
  -- 'pendiente' es que el equipo queda sin aprobar, no que deje de existir.
  perform public.confirm_registration(v_registro.id);

  select t.* into v_equipo
  from public.registrations r
  join public.teams t on t.id = r.team_id
  where r.id = v_registro.id;

  if p_estado = 'pendiente' then
    update public.teams set approved = false where id = v_equipo.id
    returning * into v_equipo;
  end if;

  return v_equipo;
end;
$$;

-- Activa o desactiva un equipo para heats, sin tocar su inscripcion ni sus
-- datos. Separado de `registrations.status` a proposito: "aprobado para
-- correr" es una decision operativa de la organizacion, no un paso mas del
-- tramite de inscripcion.
create or replace function public.set_team_approval(p_team_id uuid, p_approved boolean)
returns public.teams
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipo public.teams;
begin
  select * into v_equipo from public.teams where id = p_team_id;
  if not found then
    raise exception 'El equipo no existe';
  end if;

  if not coalesce(public.can_register_event(v_equipo.event_id), false) then
    raise exception 'No tenés permiso para aprobar equipos en esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  update public.teams set approved = p_approved where id = p_team_id
  returning * into v_equipo;

  return v_equipo;
end;
$$;

-- `auto_distribuir_heats` suma el filtro de aprobado al de "no retirado":
-- un equipo pendiente no entra al reparto automatico, igual que uno withdrawn.
create or replace function public.auto_distribuir_heats(
  p_event_id uuid,
  p_lanes_por_heat int
)
returns table (division_id uuid, division_name text, heats_creados int, equipos_asignados int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_division record;
  v_team_ids uuid[];
  v_judge_ids uuid[];
  v_numeros_ocupados int[];
  v_heat_count int;
  v_siguiente int;
  v_i int;
  v_lane_num int;
  v_team_idx int;
  v_new_heat_id uuid;
  v_judge_idx int;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Solo la organización puede distribuir heats automáticamente'
      using errcode = 'insufficient_privilege';
  end if;

  if p_lanes_por_heat is null or p_lanes_por_heat < 1 or p_lanes_por_heat > 32 then
    raise exception 'La cantidad de carriles por heat tiene que estar entre 1 y 32';
  end if;

  select array_agg(user_id order by random())
  into v_judge_ids
  from (
    select distinct s.user_id
    from public.event_staff s
    where s.event_id = p_event_id and s.user_id is not null and s.approved_at is not null
  ) jueces;

  if v_judge_ids is null or array_length(v_judge_ids, 1) = 0 then
    raise exception 'Todavía no hay jueces cargados en este evento';
  end if;

  v_judge_idx := 1;

  for v_division in
    select d.id, d.name from public.divisions d where d.event_id = p_event_id order by d.name
  loop
    -- El padron de esta categoria: equipos confirmados, APROBADOS, no
    -- retirados, que no estan corriendo YA en un heat que arranco.
    select array_agg(t.id order by t.bib_number)
    into v_team_ids
    from public.teams t
    where t.division_id = v_division.id
      and t.status <> 'withdrawn'
      and t.approved
      and not exists (
        select 1 from public.lanes l
        join public.heats h on h.id = l.heat_id
        where l.team_id = t.id and h.started_at is not null
      );

    if v_team_ids is null or array_length(v_team_ids, 1) = 0 then
      continue;
    end if;

    select coalesce(array_agg((regexp_match(h.name, '^Heat (\d+)$'))[1]::int), array[]::int[])
    into v_numeros_ocupados
    from public.heats h
    where h.event_id = p_event_id and h.division_id = v_division.id
      and h.started_at is not null and h.name ~ '^Heat \d+$';

    delete from public.heats h
    where h.event_id = p_event_id and h.division_id = v_division.id and h.started_at is null;

    v_heat_count := ceil(array_length(v_team_ids, 1)::numeric / p_lanes_por_heat);
    v_siguiente := 1;

    for v_i in 1..v_heat_count loop
      while v_siguiente = any(v_numeros_ocupados) loop
        v_siguiente := v_siguiente + 1;
      end loop;

      insert into public.heats (event_id, division_id, name, lane_count)
      values (p_event_id, v_division.id, 'Heat ' || v_siguiente, p_lanes_por_heat)
      returning id into v_new_heat_id;

      for v_lane_num in 1..p_lanes_por_heat loop
        v_team_idx := (v_i - 1) * p_lanes_por_heat + v_lane_num;
        exit when v_team_idx > array_length(v_team_ids, 1);

        insert into public.lanes (heat_id, event_id, lane_number, team_id, judge_id, claimed_at, lease_expires_at)
        values (
          v_new_heat_id, p_event_id, v_lane_num, v_team_ids[v_team_idx],
          v_judge_ids[1 + ((v_judge_idx - 1) % array_length(v_judge_ids, 1))],
          now(), now() + interval '6 hours'
        );

        v_judge_idx := v_judge_idx + 1;
      end loop;

      v_siguiente := v_siguiente + 1;
    end loop;

    division_id := v_division.id;
    division_name := v_division.name;
    heats_creados := v_heat_count;
    equipos_asignados := array_length(v_team_ids, 1);
    return next;
  end loop;
end;
$$;

-- `assign_heat_lanes` (la asignacion MANUAL desde /heats) suma la misma
-- garantia, pero como un guard explicito: el selector del cliente ya saca
-- los equipos no aprobados de la lista, pero la garantia real -- "conservar
-- que un atleta no aprobado no puede asignarse a ningun heat" -- tiene que
-- vivir en Postgres, no depender de que el cliente se porte bien.
create or replace function public.assign_heat_lanes(p_heat_id uuid, p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_lane_count int;
  v_asignados int;
  v_no_aprobados text;
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

  select string_agg(coalesce(t.name, '#' || t.bib_number::text), ', ')
  into v_no_aprobados
  from public.teams t
  where t.id = any(p_team_ids) and not t.approved;

  if v_no_aprobados is not null then
    raise exception 'Estos equipos todavía no están aprobados: %', v_no_aprobados;
  end if;

  -- Se rehace la asignacion completa. Solo se permite mientras el heat no
  -- arranco: tocar los carriles de un heat en curso dejaria marcajes apuntando
  -- a un equipo que ya no esta ahi.
  if exists (select 1 from public.heats where id = p_heat_id and started_at is not null) then
    raise exception 'El heat ya inició: no se pueden reasignar los carriles';
  end if;

  delete from public.lanes where heat_id = p_heat_id;

  v_asignados := 0;

  for i in 1..coalesce(array_length(p_team_ids, 1), 0)
  loop
    -- NULL = carril vacio. Se saltea sin consumir el numero: el carril 3 sigue
    -- siendo el 3 aunque el 1 y el 2 esten libres.
    if p_team_ids[i] is not null then
      insert into public.lanes (heat_id, event_id, lane_number, team_id)
      values (p_heat_id, v_event_id, i, p_team_ids[i]);
      v_asignados := v_asignados + 1;
    end if;
  end loop;

  if v_asignados = 0 then
    raise exception 'No se asigno ningun equipo a los carriles';
  end if;
end;
$$;

select public.apply_function_lockdown();
