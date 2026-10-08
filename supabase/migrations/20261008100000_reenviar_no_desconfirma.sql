-- Reenviar una inscripcion ya confirmada la "desconfirmaba".
--
-- EL BUG (visto en produccion, RomanoFest)
--
-- `submit_registration` no miraba el estado actual: la ultima rama hacia
-- `update ... set status = 'esperando_pago'` sin importar de donde venia. Un
-- atleta con /inscripcion/[id] abierta desde ANTES de que el organizador lo
-- marcara pagado tocaba "Confirmar inscripcion" (MisDatos -> guardarMisDatos
-- + enviarInscripcion) y la inscripcion volvia a 'esperando_pago' con su
-- `team_id` intacto: equipo, dorsal y atleta ya materializados, pero el
-- tramite diciendo que faltaba pagar.
--
-- Despues, "Marcar como pagada" llamaba a `confirm_registration`, que solo
-- era idempotente por STATUS: intentaba materializar el equipo otra vez,
-- chocaba con `athletes_email_unico` (23505) y el panel mostraba "Ese lugar
-- ya esta ocupado." sin ninguna salida.
--
-- EL ARREGLO, EN LOS DOS EXTREMOS
--
-- 1. `submit_registration`: una inscripcion confirmada se devuelve tal cual
--    (reenviar es un no-op, igual que confirmar dos veces), y una cancelada
--    se rechaza -- reabrirla no es "enviar".
-- 2. `confirm_registration`: la idempotencia pasa a mirar tambien `team_id`.
--    Si el equipo ya nacio, confirmar solo corrige el estado: nunca se
--    materializa un segundo equipo para el mismo tramite. Es la defensa que
--    cura las filas que ya quedaron mal, y cualquier otro camino futuro que
--    las deje asi.
-- 3. Backfill: las filas que este bug ya dejo en 'esperando_pago' con equipo
--    vuelven a 'confirmada'. Un tramite con `team_id` no puede estar
--    esperando pago: el equipo solo nace en `confirm_registration`.
--
-- Copias de las versiones vigentes (20260919100000_hold_de_cupo.sql) con los
-- guards agregados al principio y nada mas.

-- ---------------------------------------------------------------------------
-- submit_registration
-- ---------------------------------------------------------------------------
create or replace function public.submit_registration(p_registration_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
  v_precio public.division_registration;
  v_ocupados int;
begin
  select * into v_registro from public.registrations where id = p_registration_id;
  if not found then
    raise exception 'La inscripción no existe';
  end if;

  -- Reenviar algo ya confirmado no lo desconfirma: ver el encabezado.
  if v_registro.status = 'confirmada' then
    return v_registro;
  end if;

  if v_registro.status = 'cancelada' then
    raise exception 'Esta inscripción fue cancelada';
  end if;

  if v_registro.created_by <> auth.uid()
     and not coalesce(public.can_manage_event(v_registro.event_id), false) then
    raise exception 'Solo quien inició la inscripción puede enviarla';
  end if;

  if exists (
    select 1 from public.registration_members m
    where m.registration_id = p_registration_id and m.status <> 'completo'
  ) then
    raise exception 'Falta que algún integrante complete sus datos';
  end if;

  update public.registrations set submitted_at = coalesce(submitted_at, now())
  where id = p_registration_id;

  if coalesce(v_registro.price_cents, 0) = 0 then
    perform public.upsert_order(p_registration_id);
    return public.confirm_registration(p_registration_id);
  end if;

  -- Lock atomico por categoria -- ver el comentario de arriba del archivo.
  select * into v_precio from public.division_registration
  where division_id = v_registro.division_id
  for update;

  if v_precio.capacity is not null then
    select count(*) into v_ocupados from public.registrations
    where division_id = v_registro.division_id
      and id <> p_registration_id
      and (
        status = 'confirmada'
        or (status = 'esperando_pago'
            and (hold_expires_at is null or hold_expires_at > now()))
      );
    if v_ocupados >= v_precio.capacity then
      raise exception 'Esta categoría no tiene cupos disponibles';
    end if;
  end if;

  update public.registrations
  set status = 'esperando_pago', hold_expires_at = now() + interval '15 minutes'
  where id = p_registration_id
  returning * into v_registro;

  return v_registro;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_registration
-- ---------------------------------------------------------------------------
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
  v_precio public.division_registration;
  v_ocupados int;
begin
  select * into v_registro from public.registrations where id = p_registration_id;
  if not found then
    raise exception 'La inscripción no existe';
  end if;

  if v_registro.status = 'confirmada' then
    -- Idempotente: confirmar dos veces no crea dos equipos. Un webhook de pago
    -- que llega repetido es lo normal, no la excepcion.
    return v_registro;
  end if;

  -- El equipo ya nacio (un reenvio viejo desconfirmo el tramite): solo se
  -- corrige el estado. Materializarlo otra vez duplicaria equipo y dorsal,
  -- y choca con athletes_email_unico.
  if v_registro.team_id is not null and v_registro.status <> 'cancelada' then
    if v_registro.created_by <> auth.uid()
       and not coalesce(public.can_register_event(v_registro.event_id), false) then
      raise exception 'No podés confirmar esta inscripción';
    end if;

    update public.registrations
    set status = 'confirmada', hold_expires_at = null,
        confirmed_at = coalesce(confirmed_at, now())
    where id = p_registration_id
    returning * into v_registro;

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

  if v_registro.status <> 'esperando_pago' then
    select * into v_precio from public.division_registration
    where division_id = v_registro.division_id
    for update;

    if v_precio.capacity is not null then
      select count(*) into v_ocupados from public.registrations
      where division_id = v_registro.division_id
        and id <> p_registration_id
        and (
          status = 'confirmada'
          or (status = 'esperando_pago'
              and (hold_expires_at is null or hold_expires_at > now()))
        );
      if v_ocupados >= v_precio.capacity then
        raise exception 'Esta categoría no tiene cupos disponibles';
      end if;
    end if;
  end if;

  -- El dorsal se toma al confirmar y no antes: un tramite a medias no puede
  -- quedarse con un numero.
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
      event_id, first_name, last_name, birth_date, gender, email, phone, profile_id,
      country, document_id, state_province, box, shirt_size
    )
    values (
      v_registro.event_id, v_integrante.first_name, v_integrante.last_name,
      v_integrante.birth_date, v_integrante.gender, v_integrante.invited_email,
      v_integrante.phone, v_integrante.profile_id,
      v_integrante.country, v_integrante.document_id, v_integrante.state_province,
      v_integrante.box, v_integrante.shirt_size
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

-- ---------------------------------------------------------------------------
-- Backfill: los tramites que el bug ya desconfirmo
-- ---------------------------------------------------------------------------
update public.registrations
set status = 'confirmada', hold_expires_at = null
where team_id is not null
  and status = 'esperando_pago';

select public.apply_function_lockdown();
