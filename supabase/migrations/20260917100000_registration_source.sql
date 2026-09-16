-- De donde salio cada inscripcion.
--
-- Hoy hay dos caminos que YA convergen en `confirm_registration` (self-service
-- publico y alta manual del organizador), y un tercero que no (`import_teams`,
-- que ni pasa por `registrations` -- queda fuera de este ciclo a proposito,
-- ver la nota en el plan de rediseño). Sin este dato, la unica forma de saber
-- "esto lo cargo el organizador o se inscribio solo" era mirar si `created_by`
-- coincide con algun integrante -- que es exactamente el mismo calculo fragil
-- que ya le costo un bug real a `getMisInscripciones()` (ver el comentario en
-- esa funcion). `source` lo deja explicito en el dato, no derivado.
--
-- ADITIVO Y COMPATIBLE: las filas existentes quedan en 'self_service' por el
-- DEFAULT de la columna nueva -- no se intenta reconstruir el origen real de
-- cada inscripcion ya cargada. El proposito es auditoria HACIA ADELANTE, no
-- una migracion de datos historicos perfecta.
create type public.registration_source as enum (
  'self_service',  -- el propio atleta se inscribe (individual o como capitan de un equipo)
  'organizer',      -- alta manual desde el panel (admin_create_registration)
  'import',         -- importacion CSV -- RESERVADO: import_teams no pasa por
                     -- registrations todavia, ver Fase 2B en el plan
  'team_captain',   -- RESERVADO: hoy el capitan ES quien llama a
                     -- start_registration, asi que no hay una distincion real
                     -- que hacer -- se deja el valor para el dia en que un
                     -- capitan pueda registrar a otro atleta sin competir el
  'api',            -- RESERVADO: no existe todavia una API publica de alta
  'transfer'        -- RESERVADO: transferencia de inscripcion entre atletas,
                     -- no implementada
);

alter table public.registrations
  add column source public.registration_source not null default 'self_service';

comment on column public.registrations.source is
  'Origen del tramite. Ver el enum registration_source para el significado de cada valor. Filas creadas antes de esta columna quedan en self_service por el default -- no reconstruye historia, es auditoria hacia adelante.';

-- ---------------------------------------------------------------------------
-- admin_create_registration: deja 'organizer' en vez del default
-- ---------------------------------------------------------------------------
--
-- Copia FIEL de la version vigente (20260916110000_pago_verificado_de_verdad.sql),
-- con UN agregado: el `insert` en `registrations` ahora nombra `source`
-- explicitamente en vez de dejar que caiga en el default de la columna --
-- 'organizer' nunca deberia depender de un default pensado para el camino
-- publico.
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
    event_id, division_id, created_by, status, team_name, price_cents, currency, source
  )
  values (
    v_division.event_id, p_division_id, auth.uid(), 'borrador'::public.registration_status,
    nullif(trim(coalesce(p_team_name, '')), ''),
    v_precio.price_cents, coalesce(v_precio.currency, 'COP'),
    'organizer'::public.registration_source
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

  -- Sin costo: misma orden en $0 que ya deja `submit_registration` para el
  -- camino publico. Con costo: nada, ver el comentario en la migracion
  -- anterior (20260916110000_pago_verificado_de_verdad.sql).
  if coalesce(v_registro.price_cents, 0) = 0 then
    perform public.upsert_order(v_registro.id);
  end if;

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

select public.apply_function_lockdown();
