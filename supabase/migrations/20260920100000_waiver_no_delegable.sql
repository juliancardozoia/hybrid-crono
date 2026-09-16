-- El organizador NO puede firmar el waiver en nombre del atleta.
--
-- `admin_create_registration` marcaba `accepted_terms_at = now()` para todo
-- integrante que cargaba, a ciegas -- "la organizacion da fe del alta". Eso
-- contradice un requisito explicito del rediseño: nadie firma un waiver por
-- otra persona. La aceptacion ahora es EXPLICITA y AUDITADA por integrante:
--
--   - Si el organizador declara que la persona firmo OFFLINE (papel, en
--     persona), se marca `accepted_terms_at` igual, pero se deja constancia
--     de QUIEN lo declaro (`accepted_terms_offline_by`) -- mismo patron que
--     ya usa `confirmar_pago_manual` (`jsonb_build_object('confirmadoPor',
--     auth.uid())`), solo que aca es una columna en vez de jsonb porque no
--     hay un blob de auditoria generico en `registration_members`.
--   - Si NO lo declara, `accepted_terms_at` queda NULL: el cupo y el dorsal
--     se aseguran igual (el equipo se materializa siempre, como ya hacia),
--     pero la persona queda con la aceptacion pendiente hasta que ELLA
--     entre con su cuenta y acepte -- reusando `claim_membership`, que ya
--     funciona para cualquier `registration_members` con `profile_id null`
--     sin importar como se creo la fila.
--
-- `status = 'completo'` deja de estar atado a la aceptacion en este camino:
-- los datos esenciales los tiene el organizador (los tipeo el mismo), asi
-- que la fila esta completa como DATO desde el principio. Lo que puede
-- quedar pendiente es la aceptacion, que `registration_readiness` ahora
-- vuelve a mirar -- si falta, nunca llega a "listo", aunque el equipo ya
-- este confirmado y el pago (si hubo) ya este resuelto.

alter table public.registration_members
  add column accepted_terms_offline_by uuid references auth.users (id) on delete set null;

comment on column public.registration_members.accepted_terms_offline_by is
  'Quien declaro que este integrante acepto los terminos offline (alta manual). Null si la aceptacion la hizo la propia persona (o si todavia no la hizo).';

-- ---------------------------------------------------------------------------
-- El constraint que esto rompia, y por que se relaja (no se borra)
-- ---------------------------------------------------------------------------
--
-- `integrante_completo_tiene_datos` (desde el dia uno del modelo de
-- inscripciones) exigia `accepted_terms_at is not null` para poder marcar
-- `status = 'completo'`. Confirmado en la practica: el primer intento de esta
-- migracion violaba ese constraint apenas `admin_create_registration`
-- insertaba un integrante 'completo' sin aceptacion.
--
-- El constraint conflaba DOS cosas distintas: "tengo los datos de esta
-- persona" (nombre, apellido) y "esta persona acepto los terminos". Para el
-- camino publico las dos siempre viajan juntas -- `save_member_data` ya las
-- ata por su cuenta, con una regla MAS estricta que la que pide la base, asi
-- que relajar el constraint no le cambia el comportamiento en nada. Lo que
-- hace falta es justamente PODER separarlas para el alta manual: datos
-- completos (el organizador los tipeo) sin que eso implique una aceptacion
-- que nadie mas que la propia persona puede dar. La aceptacion pendiente
-- pasa a ser responsabilidad de `registration_readiness`, no de este
-- constraint.
alter table public.registration_members
  drop constraint integrante_completo_tiene_datos;

alter table public.registration_members
  add constraint integrante_completo_tiene_datos check (
    status <> 'completo'
    or (
      first_name is not null and length(trim(first_name)) > 0
      and last_name is not null and length(trim(last_name)) > 0
    )
  );

-- ---------------------------------------------------------------------------
-- admin_create_registration: aceptacion offline explicita, no automatica
-- ---------------------------------------------------------------------------
--
-- Copia de la version vigente (20260917100000_registration_source.sql), con
-- el cambio en el INSERT de registration_members: `accepted_terms_at` y
-- `accepted_terms_offline_by` dejan de ser incondicionales.
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
  v_offline boolean;
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

    -- Default false: sin marcar explicitamente, la aceptacion NO se supone.
    v_offline := coalesce((v_integrante ->> 'terminosAceptadosOffline')::boolean, false);

    insert into public.registration_members (
      registration_id, event_id, position, invited_email,
      first_name, last_name, birth_date, gender, phone,
      country, document_id, state_province, box, shirt_size,
      status, accepted_terms_at, accepted_terms_offline_by
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
      -- Los datos ESENCIALES los tiene el organizador (los tipeo el mismo):
      -- la fila esta completa como dato desde el principio, sin importar si
      -- la aceptacion ya esta o no. `confirm_registration` puede
      -- materializar el equipo igual -- el waiver pendiente no bloquea el
      -- cupo, lo refleja `registration_readiness` aparte.
      'completo'::public.registration_member_status,
      case when v_offline then now() else null end,
      case when v_offline then auth.uid() else null end
    );
  end loop;

  if coalesce(v_registro.price_cents, 0) = 0 then
    perform public.upsert_order(v_registro.id);
  end if;

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

-- ---------------------------------------------------------------------------
-- registration_readiness: un waiver sin aceptar tampoco es "listo"
-- ---------------------------------------------------------------------------
--
-- Copia de la version vigente (20260918100000_readiness_y_fase.sql), con un
-- chequeo nuevo: si CUALQUIER integrante no tiene `accepted_terms_at`,
-- 'accion_requerida' -- sin importar si ya se pago o si el evento es
-- gratis. En el camino de autoinscripcion esto nunca cambia nada (ahi
-- `accepted_terms_at` y `status='completo'` siempre viajan juntos, ver
-- `save_member_data`); es el alta manual sin aceptacion offline la que
-- ahora se refleja aca en vez de quedar invisible.
create or replace function public.registration_readiness(p_registration_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.registration_members m
      where m.registration_id = r.id and m.status <> 'completo'
    ) then 'incompleto'
    when coalesce(r.price_cents, 0) > 0 and (o.id is null or o.status <> 'pagada')
      then 'incompleto'
    when exists (
      select 1 from public.registration_members m
      where m.registration_id = r.id and m.accepted_terms_at is null
    ) then 'accion_requerida'
    when exists (
      select 1
      from public.registration_members m
      join public.registration_fields f
        on f.event_id = r.event_id
        and f.scope = 'integrante'
        and f.fase = 'completa'
        and f.required
        and (f.division_id is null or f.division_id = r.division_id)
      where m.registration_id = r.id
        and not (m.answers ? f.key)
    ) then 'accion_requerida'
    else 'listo'
  end
  from public.registrations r
  left join public.orders o on o.registration_id = r.id
  where r.id = p_registration_id
    and coalesce(public.puede_ver_inscripcion(p_registration_id), false);
$$;

select public.apply_function_lockdown();
