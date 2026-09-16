-- Verificacion real de pagos: "procesando" en registrar_intento_de_pago, y
-- una orden que puede existir con costo cero.
--
-- LA PARTE QUE CAMBIA DE VERDAD ESTA EN EL WEBHOOK (TypeScript), NO ACA
--
-- El verificador de MercadoPago (src/features/pagos/adapters/verificadores/
-- mercadopago.ts) ahora consulta el pago real contra la API de MercadoPago
-- despues de validar la firma, en vez de confiar en el `status` que trae el
-- cuerpo del webhook. Esta migracion solo le da a `registrar_intento_de_pago`
-- un lugar donde poner ese estado intermedio nuevo, y a `upsert_order` la
-- posibilidad de crear una orden sin costo -- las dos cosas que hacian falta
-- del lado de la base para que "PaymentStatus" salga de un solo lugar sea
-- cual sea el precio de la inscripcion.

-- ---------------------------------------------------------------------------
-- registrar_intento_de_pago: maneja 'procesando'
-- ---------------------------------------------------------------------------
--
-- Un intento "procesando" no cobra ni confirma nada -- es exactamente lo que
-- ya hacia un intento "pendiente" antes de esta migracion. La unica
-- diferencia es que ahora se refleja en `orders.status`, para que el
-- organizador (y el propio atleta) vean "MercadoPago lo esta revisando" en
-- vez de que la orden se quede muda en 'pendiente' como si nadie hubiera
-- intentado pagar todavia.
create or replace function public.registrar_intento_de_pago(
  p_order_id uuid,
  p_provider public.payment_provider,
  p_status text,
  p_external_id text default null,
  p_amount_cents int default null,
  p_raw jsonb default '{}'::jsonb
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

  insert into public.payment_attempts (
    order_id, event_id, provider, external_id, status, amount_cents, raw
  )
  values (p_order_id, v_orden.event_id, p_provider, p_external_id, p_status, p_amount_cents, p_raw)
  -- El WHERE se repite porque el indice unico es PARCIAL: sin el, Postgres no
  -- lo reconoce y responde "no unique constraint matching the ON CONFLICT".
  on conflict (provider, external_id) where external_id is not null do nothing;

  if p_status <> 'aprobado' then
    if p_status = 'rechazado' and v_orden.status in ('pendiente', 'procesando') then
      update public.orders set status = 'fallida', provider = p_provider
      where id = p_order_id returning * into v_orden;
    elsif p_status = 'procesando' and v_orden.status = 'pendiente' then
      update public.orders set status = 'procesando', provider = p_provider
      where id = p_order_id returning * into v_orden;
    end if;
    return v_orden;
  end if;

  if v_orden.status = 'pagada' then
    -- Ya estaba cobrada: no se vuelve a confirmar nada.
    return v_orden;
  end if;

  update public.orders
  set status = 'pagada', provider = p_provider, paid_at = now()
  where id = p_order_id
  returning * into v_orden;

  -- Se gasta el cupon recien cuando el pago entro de verdad: contarlo antes
  -- deja codigos agotados por gente que nunca pago.
  if v_orden.discount_code_id is not null then
    update public.discount_codes set used_count = used_count + 1
    where id = v_orden.discount_code_id;
  end if;

  -- Y acá se cierra el círculo: la inscripción se confirma y nace el equipo.
  perform public.confirm_registration(v_orden.registration_id);

  return v_orden;
end;
$$;

-- ---------------------------------------------------------------------------
-- upsert_order: ya no exige costo mayor a cero
-- ---------------------------------------------------------------------------
--
-- Antes, una inscripcion gratis nunca tenia fila en `orders`: cada pantalla
-- tenia que inferir "es gratis" por la AUSENCIA de una orden. Con esto, una
-- orden con `amount_cents = 0` es una orden como cualquier otra -- el
-- PaymentStatus sale del mismo lugar sin importar el precio. Quien la crea
-- para el caso gratuito es `submit_registration` (ver mas abajo), no el
-- atleta desde la pantalla de pago -- ahi no hay nada que el todavia tenga
-- que hacer.
create or replace function public.upsert_order(
  p_registration_id uuid,
  p_code text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
  v_orden public.orders;
  v_descuento int;
  v_motivo text;
  v_code_id uuid;
begin
  select * into v_registro from public.registrations where id = p_registration_id;
  if not found then
    raise exception 'La inscripción no existe';
  end if;

  if not coalesce(public.puede_ver_inscripcion(p_registration_id), false) then
    raise exception 'No podés operar sobre esta inscripción';
  end if;

  select * into v_orden from public.orders where registration_id = p_registration_id;

  if v_orden.status = 'pagada' then
    -- Una orden pagada no se recalcula: el monto que se cobro es historia.
    return v_orden;
  end if;

  select d.descuento_cents, d.motivo, d.code_id
  into v_descuento, v_motivo, v_code_id
  from public.evaluar_descuento(
    v_registro.event_id, v_registro.division_id, p_code, coalesce(v_registro.price_cents, 0)
  ) d;

  if v_motivo is not null then
    raise exception '%', v_motivo;
  end if;

  insert into public.orders (
    event_id, registration_id, amount_cents, currency, discount_code_id, discount_cents
  )
  values (
    v_registro.event_id, p_registration_id, coalesce(v_registro.price_cents, 0),
    coalesce(v_registro.currency, 'COP'), v_code_id, coalesce(v_descuento, 0)
  )
  on conflict (registration_id) do update set
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    discount_code_id = excluded.discount_code_id,
    discount_cents = excluded.discount_cents
  returning * into v_orden;

  return v_orden;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_registration: crea la orden sin costo antes de confirmar
-- ---------------------------------------------------------------------------
--
-- Copia FIEL de la version vigente (20260901101000_inscripciones_funciones.sql),
-- con UN solo agregado: antes de confirmar una inscripcion gratuita, arma su
-- orden en $0 -- `perform`, no `select`, porque no hace falta el valor de
-- retorno aca. `upsert_order` ya valida permisos con `puede_ver_inscripcion`,
-- que este mismo llamador (capitan o quien administra el evento) ya cumple.
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
  -- sirva de punta a punta sin pasarelas de pago. Ahora ademas deja una orden
  -- en $0: asi el PaymentStatus sale del mismo lugar sea cual sea el precio,
  -- en vez de que cada pantalla tenga que inferir "es gratis" por la
  -- ausencia de una fila en `orders`.
  if coalesce(v_registro.price_cents, 0) = 0 then
    perform public.upsert_order(p_registration_id);
    return public.confirm_registration(p_registration_id);
  end if;

  update public.registrations set status = 'esperando_pago'
  where id = p_registration_id
  returning * into v_registro;

  return v_registro;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_create_registration: misma orden en $0 para el alta manual gratuita
-- ---------------------------------------------------------------------------
--
-- Copia FIEL de la version vigente (20260904500000_aprobacion_de_equipos.sql),
-- con UN agregado: si la categoria no tiene costo, deja tambien una orden en
-- $0 -- mismo criterio que `submit_registration`, asi el PaymentStatus sale
-- del mismo lugar sin importar por que camino nacio la inscripcion.
--
-- A PROPOSITO NO SE TOCA EL CASO CON PRECIO. Hoy el alta manual de una
-- categoria PAGA no genera ninguna orden -- es la forma en que el organizador
-- carga a alguien sin pasar por el cobro de la plataforma (cortesia,
-- efectivo en mano, lo que sea), y `admin_create_registration` nunca cobra
-- este atado o no el `p_estado`. Crear ahi una orden en 'pendiente' con el
-- precio real mostraria "pago pendiente" en el panel del organizador para
-- alguien que la organizacion nunca esperó que pagara por acá -- es
-- exactamente la ambigüedad (¿'pendiente' real o cortesía?) que el plan de
-- rediseño dejó pendiente de una decisión de producto, no algo para resolver
-- calladamente en esta migración.
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
  -- camino publico. Con costo: nada, ver el comentario de arriba del archivo.
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
