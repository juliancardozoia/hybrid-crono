-- `save_member_data()` -la funcion que completa "mis datos" en la inscripcion
-- PUBLICA (individual o equipo)- nunca escribio `country`. Se agrego a
-- `registration_members`/`athletes` en 20260902100000_atletas_manual.sql,
-- pero solo `admin_create_registration()` (el alta manual del organizador) lo
-- pedia y lo copiaba. Un atleta que se auto-inscribe nunca tuvo forma de
-- cargarlo, asi que `athletes.country` quedaba NULL para todo el mundo salvo
-- los cargados a mano -- y sin el dato, la bandera de `GrillaDeAtletas` nunca
-- podia mostrarse para nadie que se hubiera anotado solo.
--
-- Mismo formato que ya usa `admin_create_registration`: ISO de dos letras,
-- mayusculas, `nullif(trim(...))` para que un string vacio quede NULL y no
-- choque contra el CHECK `country ~ '^[A-Z]{2}$'`.
--
-- Se suma a la condicion de "completo" junto a nombre/apellido/terminos: sin
-- eso, la inscripcion publica podria confirmarse sin pais mientras el alta
-- manual lo exige siempre, y las dos rutas quedarian con reglas distintas
-- para el mismo dato.
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
  v_pais text := upper(nullif(trim(coalesce(p_datos ->> 'country', '')), ''));
begin
  select * into v_fila from public.registration_members where id = p_member_id;
  if not found then
    raise exception 'El integrante no existe';
  end if;

  select * into v_registro from public.registrations where id = v_fila.registration_id;

  if v_fila.profile_id is distinct from auth.uid()
     and v_registro.created_by <> auth.uid()
     and not coalesce(public.can_manage_event(v_registro.event_id), false) then
    raise exception 'No podés editar los datos de otro integrante';
  end if;

  select * into v_evento from public.events where id = v_registro.event_id;

  if v_talla is not null
     and array_length(v_evento.shirt_sizes, 1) is not null
     and not (v_talla = any (v_evento.shirt_sizes)) then
    raise exception 'La talla % no es una de las que ofrece esta competencia', v_talla;
  end if;

  if v_pais is not null and v_pais !~ '^[A-Z]{2}$' then
    raise exception 'El país no es válido';
  end if;

  update public.registration_members
  set first_name = nullif(trim(coalesce(p_datos ->> 'firstName', '')), ''),
      last_name = nullif(trim(coalesce(p_datos ->> 'lastName', '')), ''),
      birth_date = (nullif(p_datos ->> 'birthDate', ''))::date,
      gender = (nullif(p_datos ->> 'gender', ''))::public.athlete_gender,
      phone = nullif(trim(coalesce(p_datos ->> 'phone', '')), ''),
      shirt_size = v_talla,
      country = v_pais,
      answers = coalesce(p_datos -> 'answers', '{}'::jsonb),
      accepted_terms_at = case
        when (p_datos ->> 'acceptTerms')::boolean then coalesce(accepted_terms_at, now())
        else null
      end,
      status = case
        when nullif(trim(coalesce(p_datos ->> 'firstName', '')), '') is not null
          and nullif(trim(coalesce(p_datos ->> 'lastName', '')), '') is not null
          and v_pais is not null
          and (p_datos ->> 'acceptTerms')::boolean
        then 'completo'::public.registration_member_status
        else 'invitado'
      end
  where id = p_member_id
  returning * into v_fila;

  return v_fila;
end;
$$;

select public.apply_function_lockdown();
