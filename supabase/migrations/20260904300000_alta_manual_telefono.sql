-- El alta manual ("Crear atleta") nunca pedia telefono: `admin_create_registration`
-- ni siquiera lo tenia en la lista de columnas del insert a `registration_members`,
-- asi que todo atleta creado por esa via quedaba con `athletes.phone` NULL y el
-- link de WhatsApp de la grilla no tenia con que armarse (se ve el icono
-- igual solo si hay telefono; sin el, la celda muestra "-").
--
-- La importacion CSV y la inscripcion publica ya guardaban telefono
-- (`import_teams`, `save_member_data`); esta migracion cierra el unico hueco
-- que faltaba.

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
      first_name, last_name, birth_date, gender, phone,
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
      nullif(trim(coalesce(v_integrante ->> 'phone', '')), ''),
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
