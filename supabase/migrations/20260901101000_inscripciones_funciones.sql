-- El ciclo de vida de una inscripcion.
--
-- Todas las escrituras pasan por aca: las tablas no tienen GRANT de insert ni
-- de update. Es la misma jugada que hace inmutable a timing_events — la
-- garantia es un privilegio ausente, no una politica presente.
--
-- El camino completo:
--
--   start_registration    el capitan elige categoria y empieza el tramite
--   invite_member         pone el correo real de cada integrante
--   claim_membership      cada uno entra con su cuenta y reclama su lugar
--   save_member_data      completa sus datos y acepta los terminos
--   submit_registration   el capitan la envia
--       -> sin precio: se confirma sola (competencia interna o de cortesia)
--       -> con precio: queda esperando_pago
--   confirm_registration  materializa el equipo (la llama el pago o la organizacion)

-- ---------------------------------------------------------------------------
-- Lecturas auxiliares
-- ---------------------------------------------------------------------------

-- Si una categoria admite inscripciones ahora mismo.
--
-- La ventana de la categoria manda sobre la del evento: sirve para abrir Elite
-- antes que Open, o para cerrar una categoria que ya se lleno.
create or replace function public.inscripcion_abierta(p_division_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      coalesce(dr.opens_at, e.registration_opens_at) is null
      or coalesce(dr.opens_at, e.registration_opens_at) <= now()
    )
    and (
      coalesce(dr.closes_at, e.registration_closes_at) is null
      or coalesce(dr.closes_at, e.registration_closes_at) > now()
    ),
    false
  )
  from public.divisions d
  join public.events e on e.id = d.event_id
  left join public.division_registration dr on dr.division_id = d.id
  where d.id = p_division_id;
$$;

-- Cuantos lugares quedan. Null = sin limite.
--
-- Cuenta las que ya se confirmaron Y las que estan esperando pago: guardarle el
-- lugar a alguien que esta pagando es lo minimo, si no dos personas pagan por
-- el ultimo cupo.
create or replace function public.cupos_disponibles(p_division_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when dr.capacity is null then null
    else greatest(0, dr.capacity - (
      select count(*)::int from public.registrations r
      where r.division_id = p_division_id
        and r.status in ('confirmada', 'esperando_pago')
    ))
  end
  from public.division_registration dr
  where dr.division_id = p_division_id;
$$;

-- ---------------------------------------------------------------------------
-- Empezar
-- ---------------------------------------------------------------------------

create or replace function public.start_registration(
  p_division_id uuid,
  p_team_name text default null
)
returns public.registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_division public.divisions;
  v_evento public.events;
  v_precio public.division_registration;
  v_registro public.registrations;
  v_email text;
  v_cupos int;
begin
  if auth.uid() is null then
    raise exception 'Hay que entrar con una cuenta para inscribirse';
  end if;

  select * into v_division from public.divisions where id = p_division_id;
  if not found then
    raise exception 'La categoría no existe';
  end if;

  select * into v_evento from public.events where id = v_division.event_id;

  -- Una competencia que no se publico no recibe inscripciones por el portal.
  -- La organizacion igual puede anotar gente a mano.
  if v_evento.published_at is null and not coalesce(public.can_manage_event(v_evento.id), false) then
    raise exception 'Esta competencia todavía no abrió inscripciones';
  end if;

  if not public.inscripcion_abierta(p_division_id)
     and not coalesce(public.can_manage_event(v_evento.id), false) then
    raise exception 'Las inscripciones de esta categoría están cerradas';
  end if;

  v_cupos := public.cupos_disponibles(p_division_id);
  if v_cupos is not null and v_cupos <= 0 then
    raise exception 'Esta categoría no tiene cupos disponibles';
  end if;

  select * into v_precio from public.division_registration where division_id = p_division_id;

  -- Nadie se inscribe dos veces en la misma categoria. Una cancelada no cuenta:
  -- se puede volver a intentar.
  if exists (
    select 1 from public.registrations r
    where r.division_id = p_division_id
      and r.created_by = auth.uid()
      and r.status <> 'cancelada'
  ) then
    raise exception 'Ya tenés una inscripción en esta categoría';
  end if;

  insert into public.registrations (
    event_id, division_id, created_by, status, team_name,
    -- El precio se congela ahora: si el organizador lo sube despues, quien ya
    -- se anoto paga lo que le dijeron.
    price_cents, currency
  )
  values (
    v_division.event_id, p_division_id, auth.uid(),
    case when v_division.team_size > 1
         then 'esperando_integrantes'::public.registration_status
         else 'borrador'::public.registration_status end,
    nullif(trim(coalesce(p_team_name, '')), ''),
    v_precio.price_cents, coalesce(v_precio.currency, 'COP')
  )
  returning * into v_registro;

  -- El capitan ocupa el primer lugar con su propio correo.
  select email into v_email from public.profiles where id = auth.uid();

  insert into public.registration_members (
    registration_id, event_id, position, profile_id, invited_email
  )
  values (v_registro.id, v_division.event_id, 1, auth.uid(), coalesce(v_email, 'sin-correo@local'));

  return v_registro;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitar y reclamar
-- ---------------------------------------------------------------------------

create or replace function public.invite_member(
  p_registration_id uuid,
  p_position int,
  p_email text
)
returns public.registration_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
  v_division public.divisions;
  v_fila public.registration_members;
  v_email text := lower(trim(p_email));
begin
  select * into v_registro from public.registrations where id = p_registration_id;
  if not found then
    raise exception 'La inscripción no existe';
  end if;

  -- Solo el capitan y la organizacion mueven integrantes.
  if v_registro.created_by <> auth.uid()
     and not coalesce(public.can_manage_event(v_registro.event_id), false) then
    raise exception 'Solo quien inició la inscripción puede invitar integrantes';
  end if;

  if v_registro.status in ('confirmada', 'cancelada') then
    -- Cambiar integrantes despues de confirmar depende de lo que permita la
    -- categoria: hay competencias que lo aceptan hasta el dia previo.
    if not exists (
      select 1 from public.division_registration dr
      where dr.division_id = v_registro.division_id and dr.allows_member_swap
    ) then
      raise exception 'Esta inscripción ya está cerrada';
    end if;
  end if;

  select * into v_division from public.divisions where id = v_registro.division_id;

  if p_position < 1 or p_position > v_division.team_size then
    raise exception 'Esta categoría es de % integrante(s)', v_division.team_size;
  end if;

  if position('@' in v_email) < 2 then
    raise exception 'El correo no es válido';
  end if;

  insert into public.registration_members (
    registration_id, event_id, position, invited_email,
    -- Si el correo ya tiene cuenta, queda enlazado de una: la persona entra y
    -- ve su inscripcion sin tener que reclamar nada.
    profile_id
  )
  values (
    p_registration_id, v_registro.event_id, p_position, v_email,
    (select id from public.profiles where lower(email) = v_email)
  )
  on conflict (registration_id, position) do update
    set invited_email = excluded.invited_email,
        profile_id = excluded.profile_id,
        -- Cambiar de persona borra los datos de la anterior: no son suyos.
        status = 'invitado',
        first_name = null, last_name = null, birth_date = null,
        gender = null, phone = null, shirt_size = null,
        answers = '{}'::jsonb, accepted_terms_at = null
  returning * into v_fila;

  return v_fila;
end;
$$;

-- Enlaza al usuario que entra con el lugar que le reservaron por correo.
--
-- Se llama sola cuando alguien abre una inscripcion: es el equivalente de
-- accept_pending_invitations para las organizaciones.
create or replace function public.claim_membership(p_registration_id uuid)
returns public.registration_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_fila public.registration_members;
begin
  if auth.uid() is null then
    raise exception 'Hay que entrar con una cuenta';
  end if;

  select lower(email) into v_email from public.profiles where id = auth.uid();

  update public.registration_members
  set profile_id = auth.uid()
  where registration_id = p_registration_id
    and profile_id is null
    and lower(invited_email) = v_email
  returning * into v_fila;

  if v_fila.id is null then
    -- Ya lo tenia reclamado, o el lugar no es suyo.
    select * into v_fila from public.registration_members
    where registration_id = p_registration_id and profile_id = auth.uid();
  end if;

  return v_fila;
end;
$$;

-- ---------------------------------------------------------------------------
-- Completar los datos
-- ---------------------------------------------------------------------------

create or replace function public.save_member_data(
  p_member_id uuid,
  p_datos jsonb
)
returns public.registration_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fila public.registration_members;
  v_registro public.registrations;
  v_evento public.events;
  v_talla text := nullif(trim(coalesce(p_datos ->> 'shirtSize', '')), '');
begin
  select * into v_fila from public.registration_members where id = p_member_id;
  if not found then
    raise exception 'El integrante no existe';
  end if;

  select * into v_registro from public.registrations where id = v_fila.registration_id;

  -- Cada uno completa lo suyo. El capitan y la organizacion pueden completar
  -- por otro: en la practica alguien siempre carga los datos de un companero
  -- que no abre el link.
  if v_fila.profile_id is distinct from auth.uid()
     and v_registro.created_by <> auth.uid()
     and not coalesce(public.can_manage_event(v_registro.event_id), false) then
    raise exception 'No podés editar los datos de otro integrante';
  end if;

  select * into v_evento from public.events where id = v_registro.event_id;

  -- La talla tiene que ser una de las que ofrece el evento. Sin este chequeo
  -- entra cualquier texto y el organizador termina con "L", "l" y "Large".
  if v_talla is not null
     and array_length(v_evento.shirt_sizes, 1) is not null
     and not (v_talla = any (v_evento.shirt_sizes)) then
    raise exception 'La talla % no es una de las que ofrece esta competencia', v_talla;
  end if;

  update public.registration_members
  set first_name = nullif(trim(coalesce(p_datos ->> 'firstName', '')), ''),
      last_name = nullif(trim(coalesce(p_datos ->> 'lastName', '')), ''),
      birth_date = (nullif(p_datos ->> 'birthDate', ''))::date,
      gender = (nullif(p_datos ->> 'gender', ''))::public.athlete_gender,
      phone = nullif(trim(coalesce(p_datos ->> 'phone', '')), ''),
      shirt_size = v_talla,
      answers = coalesce(p_datos -> 'answers', '{}'::jsonb),
      accepted_terms_at = case
        when (p_datos ->> 'acceptTerms')::boolean then coalesce(accepted_terms_at, now())
        else null
      end,
      status = case
        when nullif(trim(coalesce(p_datos ->> 'firstName', '')), '') is not null
          and nullif(trim(coalesce(p_datos ->> 'lastName', '')), '') is not null
          and (p_datos ->> 'acceptTerms')::boolean
        then 'completo'::public.registration_member_status
        else 'invitado'
      end
  where id = p_member_id
  returning * into v_fila;

  return v_fila;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirmar: aca nace el equipo
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
  v_cupos int;
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

  if v_registro.created_by <> auth.uid()
     and not coalesce(public.can_manage_event(v_registro.event_id), false) then
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

-- El capitan da por terminado el tramite.
create or replace function public.submit_registration(p_registration_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
begin
  select * into v_registro from public.registrations where id = p_registration_id;
  if not found then
    raise exception 'La inscripción no existe';
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

  -- Sin precio no hay nada que cobrar: una competencia interna o una categoria
  -- de cortesia se confirma en el acto. Es lo que hace que el plan gratuito
  -- sirva de punta a punta sin pasarelas de pago.
  if coalesce(v_registro.price_cents, 0) = 0 then
    return public.confirm_registration(p_registration_id);
  end if;

  update public.registrations set status = 'esperando_pago'
  where id = p_registration_id
  returning * into v_registro;

  return v_registro;
end;
$$;

create or replace function public.cancel_registration(p_registration_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
begin
  select * into v_registro from public.registrations where id = p_registration_id;
  if not found then
    raise exception 'La inscripción no existe';
  end if;

  if v_registro.created_by <> auth.uid()
     and not coalesce(public.can_manage_event(v_registro.event_id), false) then
    raise exception 'No podés cancelar esta inscripción';
  end if;

  -- Cancelar una confirmada le saca el equipo de la competencia. El equipo no
  -- se borra: se retira, para que sus tiempos —si llego a correr— no
  -- desaparezcan.
  if v_registro.team_id is not null then
    update public.teams set status = 'withdrawn' where id = v_registro.team_id;
  end if;

  update public.registrations set status = 'cancelada' where id = p_registration_id
  returning * into v_registro;

  return v_registro;
end;
$$;

-- ---------------------------------------------------------------------------
-- El formulario, para el portal publico
-- ---------------------------------------------------------------------------
--
-- Lo puede pedir cualquiera —hasta sin cuenta— porque es el formulario EN
-- BLANCO: que categorias hay, cuanto salen, cuantos cupos quedan y que se
-- pregunta. Nada de esto es privado; es justo lo que alguien necesita para
-- decidir si se anota.

create or replace function public.public_registration_form(p_public_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'slug', e.public_slug,
    'name', e.name,
    'timezone', e.timezone,
    'shirtSizes', e.shirt_sizes,
    'abierta', (
      (e.registration_opens_at is null or e.registration_opens_at <= now())
      and (e.registration_closes_at is null or e.registration_closes_at > now())
    ),
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'teamSize', d.team_size,
        'genderRule', d.gender_rule,
        'ageMin', d.age_min,
        'ageMax', d.age_max,
        'level', d.level,
        'priceCents', dr.price_cents,
        'currency', coalesce(dr.currency, 'COP'),
        'cuposDisponibles', public.cupos_disponibles(d.id),
        'abierta', public.inscripcion_abierta(d.id)
      ) order by d.name)
      from public.divisions d
      left join public.division_registration dr on dr.division_id = d.id
      where d.event_id = e.id
    ), '[]'::jsonb),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', f.key, 'label', f.label, 'type', f.type,
        'required', f.required, 'options', f.options,
        'scope', f.scope, 'divisionId', f.division_id
      ) order by f.order_index)
      from public.registration_fields f where f.event_id = e.id
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', doc.name, 'url', doc.url, 'requiresAcceptance', doc.requires_acceptance
      ) order by doc.order_index)
      from public.event_documents doc where doc.event_id = e.id
    ), '[]'::jsonb)
  )
  from public.events e
  where e.public_slug = p_public_slug and e.published_at is not null;
$$;

select public.apply_function_lockdown();
