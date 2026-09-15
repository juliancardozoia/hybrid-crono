-- Documento, provincia/estado y box en el PERFIL de la cuenta -- no solo en
-- la inscripcion de una competencia.
--
-- Hasta ahora estos tres datos solo entraban por el alta manual del
-- organizador (`admin_create_registration`): un atleta que se inscribe SOLO
-- nunca tenia forma de cargarlos, porque `CamposDeAtleta`/`save_member_data`
-- no los pedian ni los escribian. Se agregan al mismo formulario publico, y
-- se agregan tambien a `profiles` para que -como ya pasa con telefono y
-- fecha de nacimiento- una vez cargados en una competencia no se vuelvan a
-- preguntar en la siguiente: EL PERFIL ES UNO SOLO PARA TODA LA PLATAFORMA.
--
-- `athletes`/`registration_members` siguen siendo la foto congelada por
-- competencia -eso no cambia-, pero ahora el perfil es de donde sale el
-- valor la PRIMERA vez que hace falta, igual que ya pasa con el resto de los
-- campos de identidad.

alter table public.profiles
  add column document_id text,
  add column state_province text,
  add column box text;

-- UNICO POR PLATAFORMA, no por competencia. `athletes.document_id` sigue
-- siendo unico solo DENTRO de cada evento (dos competencias distintas pueden
-- tener el mismo documento sin problema); esto es distinto: un documento no
-- puede pertenecer a DOS CUENTAS de Scora. Es la barrera contra que alguien
-- se cree una segunda cuenta para eludir un cupo o una sancion.
create unique index profiles_documento_unico
  on public.profiles (upper(trim(document_id)))
  where document_id is not null and trim(document_id) <> '';

-- ---------------------------------------------------------------------------
-- `save_member_data()` ahora tambien escribe estos tres campos
-- ---------------------------------------------------------------------------
--
-- No se agregan a la condicion de "completo": documento, provincia/estado y
-- box nunca bloquearon nada en la base (a diferencia de nombre/apellido/pais/
-- terminos), y agregarlos ahora rompería inscripciones que ya se enviaron sin
-- ese requisito.
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
  v_documento text := nullif(trim(coalesce(p_datos ->> 'documentId', '')), '');
  v_provincia text := nullif(trim(coalesce(p_datos ->> 'stateProvince', '')), '');
  v_box text := nullif(trim(coalesce(p_datos ->> 'box', '')), '');
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
      document_id = v_documento,
      state_province = v_provincia,
      box = v_box,
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
