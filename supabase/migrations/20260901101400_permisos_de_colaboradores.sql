-- Conecta los permisos nuevos con las funciones que deberian usarlos.
--
-- Crear los roles no sirve de nada si las funciones siguen preguntando por los
-- permisos viejos: un `scorekeeper` podria entrar al evento y no poder cargar
-- un solo resultado, que es literalmente lo unico que vino a hacer.

-- Cargar un resultado a mano ya no exige poder verificar: para eso existe el
-- rol de scorekeeper. Verificar y publicar siguen siendo de la organizacion.
create or replace function public.upsert_workout_score(
  p_part_id uuid,
  p_team_id uuid,
  p_score jsonb
)
returns public.workout_scores
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parte public.workout_parts;
  v_event_id uuid;
  v_division_id uuid;
  v_status public.score_status;
  v_fila public.workout_scores;
begin
  select * into v_parte from public.workout_parts where id = p_part_id;
  if not found then
    raise exception 'La prueba no existe';
  end if;

  v_event_id := v_parte.event_id;

  -- coalesce obligatorio: en plpgsql `if not NULL then` NO entra al bloque, asi
  -- que un guard escrito sin esto deja pasar justo a quien no es miembro.
  if not coalesce(public.can_score_event(v_event_id), false) then
    raise exception 'No tienes permiso para cargar resultados en este evento';
  end if;

  if v_parte.capture_mode = 'en_vivo' then
    raise exception 'Esta prueba se captura en vivo: su resultado no se carga a mano';
  end if;

  select division_id into v_division_id
  from public.teams
  where id = p_team_id and event_id = v_event_id;

  if v_division_id is null then
    raise exception 'El equipo no pertenece a este evento';
  end if;

  if not exists (
    select 1 from public.part_divisions
    where part_id = p_part_id and division_id = v_division_id
  ) then
    raise exception 'La categoria de este equipo no corre esta prueba';
  end if;

  v_status := coalesce((p_score ->> 'status')::public.score_status, 'valido');

  insert into public.workout_scores as ws (
    part_id, team_id, event_id, division_id, score_unit, status,
    value_num, value_reps, value_cap, tiebreak_value,
    source, lane_id, entered_by, entered_at
  )
  values (
    p_part_id, p_team_id, v_event_id, v_division_id, v_parte.score_unit, v_status,
    (p_score ->> 'value')::numeric,
    (p_score ->> 'reps')::int,
    (p_score ->> 'capValue')::numeric,
    (p_score ->> 'tiebreak')::numeric,
    'manual', null, auth.uid(), now()
  )
  on conflict (part_id, team_id) do update set
    status = excluded.status,
    value_num = excluded.value_num,
    value_reps = excluded.value_reps,
    value_cap = excluded.value_cap,
    tiebreak_value = excluded.tiebreak_value,
    entered_by = excluded.entered_by,
    entered_at = excluded.entered_at,
    verified_by = null,
    verified_at = null
  where ws.source = 'manual'
  returning * into v_fila;

  if not found then
    raise exception 'Este resultado lo produjo el cronometro: no se puede editar a mano';
  end if;

  return v_fila;
end;
$$;

-- Confirmar una transferencia es trabajo de quien atiende inscripciones.
create or replace function public.confirmar_pago_manual(
  p_order_id uuid,
  p_referencia text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orden public.orders;
begin
  select * into v_orden from public.orders where id = p_order_id;
  if not found then
    raise exception 'La orden no existe';
  end if;

  if not coalesce(public.can_register_event(v_orden.event_id), false) then
    raise exception 'Solo la organización puede confirmar un pago'
      using errcode = 'insufficient_privilege';
  end if;

  return public.registrar_intento_de_pago(
    p_order_id,
    'transferencia',
    'aprobado',
    coalesce(nullif(trim(coalesce(p_referencia, '')), ''), 'manual-' || p_order_id::text),
    v_orden.total_cents,
    jsonb_build_object('confirmadoPor', auth.uid(), 'referencia', p_referencia)
  );
end;
$$;

-- Y lo mismo del lado de las inscripciones: invitar, completar y confirmar.
create or replace function public.confirm_registration(p_registration_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
  v_division public.divisions;
  v_team_id uuid;
  v_dorsal int;
  v_integrante public.registration_members;
  v_athlete_id uuid;
  v_cupos int;
begin
  select * into v_registro from public.registrations where id = p_registration_id;
  if not found then
    raise exception 'La inscripción no existe';
  end if;

  if v_registro.status = 'confirmada' then
    -- Idempotente: un webhook de pago que llega repetido es lo normal.
    return v_registro;
  end if;

  if v_registro.created_by <> auth.uid()
     and not coalesce(public.can_register_event(v_registro.event_id), false) then
    raise exception 'No podés confirmar esta inscripción';
  end if;

  select * into v_division from public.divisions where id = v_registro.division_id;

  if exists (
    select 1 from public.registration_members m
    where m.registration_id = p_registration_id and m.status <> 'completo'
  ) then
    raise exception 'Falta que algún integrante complete sus datos';
  end if;

  if (select count(*) from public.registration_members m where m.registration_id = p_registration_id)
     <> v_division.team_size then
    raise exception 'Esta categoría es de % integrante(s)', v_division.team_size;
  end if;

  v_cupos := public.cupos_disponibles(v_registro.division_id);
  if v_cupos is not null and v_cupos <= 0 and v_registro.status <> 'esperando_pago' then
    raise exception 'Esta categoría no tiene cupos disponibles';
  end if;

  select coalesce(max(bib_number), 0) + 1 into v_dorsal
  from public.teams where event_id = v_registro.event_id;

  insert into public.teams (event_id, division_id, name, bib_number)
  values (v_registro.event_id, v_registro.division_id, v_registro.team_name, v_dorsal)
  returning id into v_team_id;

  for v_integrante in
    select * from public.registration_members
    where registration_id = p_registration_id order by position
  loop
    insert into public.athletes (
      event_id, first_name, last_name, birth_date, gender, email, phone, profile_id
    )
    values (
      v_registro.event_id, v_integrante.first_name, v_integrante.last_name,
      v_integrante.birth_date, v_integrante.gender, v_integrante.invited_email,
      v_integrante.phone, v_integrante.profile_id
    )
    returning id into v_athlete_id;

    insert into public.team_members (team_id, athlete_id, event_id)
    values (v_team_id, v_athlete_id, v_registro.event_id);
  end loop;

  update public.registrations
  set status = 'confirmada', team_id = v_team_id, confirmed_at = now()
  where id = p_registration_id
  returning * into v_registro;

  return v_registro;
end;
$$;

select public.apply_function_lockdown();
