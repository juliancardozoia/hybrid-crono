-- El nucleo del rediseño: "PAGADO no significa LISTO PARA COMPETIR".
--
-- Hasta ahora `registrations.status` era la unica señal de estado que veia
-- el atleta, y `confirmada` ya se leia (mal) como "ya esta, no hay nada mas
-- que hacer". Esta migracion agrega las dos piezas que le faltaban a la base
-- para que la UX pueda mostrar la distincion real:
--
--   1. `registration_fields.fase` -- que campos custom se piden ANTES de
--      pagar (esencial) y cuales se pueden diferir para DESPUES (completa).
--   2. `registration_readiness()` -- una funcion, no una columna, que
--      calcula si a esta inscripcion le falta algo. Se calcula on-demand
--      por la misma razon que ya aplican `cupos_disponibles`/
--      `inscripcion_abierta`: depende de datos que cambian por fuera de
--      `registrations` (integrantes, pago, respuestas), y una columna
--      quedaria desincronizada apenas alguno de esos cambiara sin pasar por
--      un trigger dedicado.
--
-- LO QUE ESTA MIGRACION NO HACE, A PROPOSITO
--
-- No modela "waiver diferido" como un caso aparte: la aceptacion de terminos
-- sigue siendo el unico `accepted_terms_at` que ya existe (ver la decision
-- de mantener el checkbox unico, documentada en el plan de rediseño). No
-- agrega ningun campo "requerido" nuevo para telefono/talla/documento/box:
-- esos son operacionales por definicion (fase completa) pero no hay hoy
-- ningun mecanismo de "obligatorio" para ellos mas alla de los
-- `registration_fields` que el organizador ya puede marcar `required`.
-- Inventar esa obligatoriedad para columnas fijas es una decision de
-- producto que no estaba pedida en este ciclo.

-- ---------------------------------------------------------------------------
-- registration_fields.fase
-- ---------------------------------------------------------------------------
--
-- Aditivo: todos los campos existentes quedan en 'esencial' por default, que
-- es exactamente lo que ya hacian -- hoy TODO se pide antes de pagar, asi
-- que ningun campo cambia de comportamiento con este agregado.
alter table public.registration_fields
  add column fase text not null default 'esencial' check (fase in ('esencial', 'completa'));

comment on column public.registration_fields.fase is
  'Cuando se pide este campo: esencial (antes de pagar, junto con nombre/categoria/terminos) o completa (despues de pagar, junto con telefono/talla/documento). Default esencial para no cambiar el comportamiento de los campos ya cargados.';

-- ---------------------------------------------------------------------------
-- save_member_data: separa lo esencial de lo operacional
-- ---------------------------------------------------------------------------
--
-- DEFAULT = 'completa', A PROPOSITO DISTINTO DE LO QUE PROPONIA EL PLAN
-- ORIGINAL (que sugeria default 'esencial'). El formulario publico HOY sigue
-- siendo una sola pantalla (`CamposDeAtleta.tsx`) que manda todos los campos
-- juntos en un solo llamado -- eso no cambia hasta que la Fase 4 construya
-- las dos pantallas. Si el default fuera 'esencial', cada guardado de HOY
-- dejaria de escribir telefono/talla/documento/box/respuestas sin que
-- ningun llamador haya cambiado una linea: seria una regresion silenciosa.
-- Con default 'completa', todo llamador existente sigue escribiendo
-- exactamente lo mismo que escribia ayer -- el modo 'esencial' queda
-- disponible para cuando la Fase 4 llame a esta misma funcion desde la
-- primera pantalla, antes de que exista una orden.
--
-- EN FASE ESENCIAL, LOS CAMPOS OPERACIONALES NO SE TOCAN (ni se leen del
-- payload ni se escriben) -- es la garantia de que la primera pantalla nunca
-- puede borrar lo que la segunda ya guardo. En fase completa se escriben
-- igual que siempre.
--
-- `create or replace function` NO reemplaza una funcion si cambia la
-- ARIDAD: agregar `p_fase` (con default) a una funcion que tenia 2
-- parametros deja DOS funciones `save_member_data` coexistiendo hasta que
-- se borra la firma vieja a mano -- si no, cualquier llamada con 2
-- argumentos revienta con "is not unique". Misma trampa que ya le paso a
-- `admin_create_registration` (ver 20260904400100_admin_create_registration_arity.sql).
drop function if exists public.save_member_data(uuid, jsonb);

create or replace function public.save_member_data(
  p_member_id uuid,
  p_datos jsonb,
  p_fase text default 'completa'
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
  if p_fase not in ('esencial', 'completa') then
    raise exception 'Fase de inscripción inválida: %', p_fase;
  end if;

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

  -- La talla es un dato operacional: solo se valida (y se escribe) en fase
  -- completa.
  if p_fase = 'completa' and v_talla is not null
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
      country = v_pais,
      accepted_terms_at = case
        when (p_datos ->> 'acceptTerms')::boolean then coalesce(accepted_terms_at, now())
        else null
      end,
      -- Operacionales: solo se pisan en fase completa. En fase esencial
      -- quedan exactamente como estaban.
      phone = case when p_fase = 'completa'
        then nullif(trim(coalesce(p_datos ->> 'phone', '')), '') else phone end,
      shirt_size = case when p_fase = 'completa' then v_talla else shirt_size end,
      document_id = case when p_fase = 'completa' then v_documento else document_id end,
      state_province = case when p_fase = 'completa' then v_provincia else state_province end,
      box = case when p_fase = 'completa' then v_box else box end,
      answers = case when p_fase = 'completa'
        then coalesce(p_datos -> 'answers', '{}'::jsonb) else answers end,
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

-- ---------------------------------------------------------------------------
-- public_registration_form: expone la fase de cada campo
-- ---------------------------------------------------------------------------
--
-- Copia FIEL de la version vigente (20260901101000_inscripciones_funciones.sql),
-- con UN agregado (`'fase', f.fase` en el jsonb de cada campo) para que la
-- pantalla publica ya pueda filtrar por fase el dia que la Fase 4 divida el
-- formulario en dos pasos, sin necesitar otra migracion solo para esto.
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
        'scope', f.scope, 'divisionId', f.division_id, 'fase', f.fase
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

-- ---------------------------------------------------------------------------
-- registration_readiness: la señal nueva
-- ---------------------------------------------------------------------------
--
-- 'incompleto'        -- falta algun integrante, o falta pagar (con costo).
-- 'accion_requerida'  -- ya esta pagada/gratis, pero falta un campo de fase
--                         completa que el organizador marco obligatorio.
-- 'listo'             -- no falta nada de lo que esta funcion sabe evaluar.
--
-- STABLE y SECURITY DEFINER, mismo patron que `cupos_disponibles`: se
-- recalcula en cada lectura en vez de guardarse, porque depende de datos que
-- cambian por fuera de `registrations` (integrantes, orden, respuestas) y
-- una columna se desincronizaria apenas alguno de esos cambiara sin pasar
-- por un trigger dedicado a mantenerla.
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
    -- Con costo, sin orden pagada: todavia no se aseguro el cupo. Cubre
    -- tanto "nunca se armo la orden" (o.id is null) como "se armo pero no
    -- se pago" -- las dos son la misma señal para el atleta.
    when coalesce(r.price_cents, 0) > 0 and (o.id is null or o.status <> 'pagada')
      then 'incompleto'
    -- Pagada (o gratis) pero falta una respuesta obligatoria de fase
    -- completa, para la categoria de esta inscripcion o para todas.
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
