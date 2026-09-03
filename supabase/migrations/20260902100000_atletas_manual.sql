-- El alta manual de un atleta, UNIFICADA con el sistema de inscripciones.
--
-- Hasta ahora `createAthleteTeam` (src/features/athletes/actions.ts)
-- escribia DIRECTO en `athletes`/`teams`, sin pasar por `registrations`. Es un
-- segundo camino por el que puede nacer un equipo, y el proyecto tiene una
-- regla explicita para esto: "un solo lugar donde nace un equipo" —
-- `confirm_registration()`. Esta migracion agrega el camino que faltaba para
-- que el alta manual entre por ahi tambien, en vez de tener dos.
--
-- Pais, documento y provincia/estado son datos de IDENTIDAD del atleta, al
-- mismo nivel que nombre o fecha de nacimiento —no un campo que cada
-- competencia inventa distinto (eso ya existe: `registration_fields`)— asi que
-- son columnas fijas, igual que `first_name`/`birth_date`, y no entradas en
-- `answers`.

alter table public.registration_members
  add column country text check (country ~ '^[A-Z]{2}$'),
  add column document_id text,
  add column state_province text;

alter table public.athletes
  add column country text check (country ~ '^[A-Z]{2}$'),
  add column document_id text,
  add column state_province text;

-- `confirm_registration()` se redefine para copiar los tres campos nuevos al
-- materializar el atleta. El resto de la funcion no cambia.
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
      event_id, first_name, last_name, birth_date, gender, email, phone, profile_id,
      country, document_id, state_province
    )
    values (
      v_registro.event_id, v_integrante.first_name, v_integrante.last_name,
      v_integrante.birth_date, v_integrante.gender, v_integrante.invited_email,
      v_integrante.phone, v_integrante.profile_id,
      v_integrante.country, v_integrante.document_id, v_integrante.state_province
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

-- El alta manual: arma la inscripcion y sus integrantes con los datos que el
-- organizador ya tiene, y llama a `confirm_registration()` para materializar
-- el equipo — la MISMA funcion que usa el portal publico, no una copia.
--
-- QUEDA CONFIRMADA DIRECTO, sin pasar por precio ni pago: es la organizacion
-- registrando a alguien que ya esta ahi (cortesia, pago en efectivo, walk-in),
-- no un tramite de pago por el portal. Si la categoria tiene precio, esta via
-- no lo cobra — el cobro real sigue pasando por la inscripcion publica.
--
-- `p_integrantes` es un array de objetos con las MISMAS claves que ya usa
-- `save_member_data` (firstName, lastName, birthDate, gender) mas las tres
-- nuevas (country, documentId, stateProvince) y email, que aca es obligatorio
-- porque no hay a quien invitar despues: la fila queda 'completo' de una.
create or replace function public.admin_create_registration(
  p_division_id uuid,
  p_team_name text,
  p_integrantes jsonb
)
returns public.teams
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_division public.divisions;
  v_registro public.registrations;
  v_precio public.division_registration;
  v_integrante jsonb;
  v_posicion int := 0;
  v_equipo public.teams;
begin
  select * into v_division from public.divisions where id = p_division_id;
  if not found then
    raise exception 'La categoría no existe';
  end if;

  if not coalesce(public.can_register_event(v_division.event_id), false) then
    raise exception 'No tenés permiso para registrar atletas en esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

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

    insert into public.registration_members (
      registration_id, event_id, position, invited_email,
      first_name, last_name, birth_date, gender,
      country, document_id, state_province,
      status, accepted_terms_at
    )
    values (
      v_registro.id, v_division.event_id, v_posicion,
      lower(trim(v_integrante ->> 'email')),
      nullif(trim(coalesce(v_integrante ->> 'firstName', '')), ''),
      nullif(trim(coalesce(v_integrante ->> 'lastName', '')), ''),
      nullif(v_integrante ->> 'birthDate', '')::date,
      nullif(v_integrante ->> 'gender', '')::public.athlete_gender,
      upper(nullif(trim(coalesce(v_integrante ->> 'country', '')), '')),
      nullif(trim(coalesce(v_integrante ->> 'documentId', '')), ''),
      nullif(trim(coalesce(v_integrante ->> 'stateProvince', '')), ''),
      -- 'completo' de una: el organizador ya tiene los datos, no hay a quien
      -- esperar. `accepted_terms_at` se marca porque `confirm_registration` no
      -- exige status='completo' sin ella (misma regla que `save_member_data`),
      -- y aca es la organizacion la que da fe del alta, no un formulario propio.
      'completo'::public.registration_member_status, now()
    );
  end loop;

  perform public.confirm_registration(v_registro.id);

  select t.* into v_equipo
  from public.registrations r
  join public.teams t on t.id = r.team_id
  where r.id = v_registro.id;

  return v_equipo;
end;
$$;

select public.apply_function_lockdown();
