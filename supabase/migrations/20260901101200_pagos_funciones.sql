-- El ciclo de vida de una orden.
--
-- Una inscripcion con precio genera UNA orden. Reintentar un pago no crea otra:
-- agrega un intento. Cuando un intento llega aprobado, la orden pasa a `pagada`
-- y la inscripcion se confirma sola — que es donde nace el equipo.

-- ---------------------------------------------------------------------------
-- Descuentos
-- ---------------------------------------------------------------------------

-- Valida un codigo y devuelve cuanto descuenta. Cero si no aplica.
--
-- Devuelve el motivo junto con el monto para que la pantalla pueda decir POR
-- QUE no se aplico: "vencido" y "no existe" se arreglan distinto.
create or replace function public.evaluar_descuento(
  p_event_id uuid,
  p_division_id uuid,
  p_code text,
  p_monto_cents int
)
returns table (descuento_cents int, motivo text, code_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.discount_codes;
begin
  if p_code is null or trim(p_code) = '' then
    return query select 0, null::text, null::uuid;
    return;
  end if;

  select * into v_code from public.discount_codes
  where event_id = p_event_id and upper(code) = upper(trim(p_code));

  if not found or not v_code.active then
    return query select 0, 'Ese código no existe.'::text, null::uuid;
    return;
  end if;

  if v_code.valid_from is not null and v_code.valid_from > now() then
    return query select 0, 'Ese código todavía no está vigente.'::text, null::uuid;
    return;
  end if;

  if v_code.valid_to is not null and v_code.valid_to < now() then
    return query select 0, 'Ese código ya venció.'::text, null::uuid;
    return;
  end if;

  if v_code.max_uses is not null and v_code.used_count >= v_code.max_uses then
    return query select 0, 'Ese código ya se agotó.'::text, null::uuid;
    return;
  end if;

  if v_code.division_id is not null and v_code.division_id <> p_division_id then
    return query select 0, 'Ese código no aplica a esta categoría.'::text, null::uuid;
    return;
  end if;

  return query select
    -- Un descuento nunca puede dejar el total en negativo.
    least(
      p_monto_cents,
      case when v_code.kind = 'porcentaje'
           then (p_monto_cents * v_code.value) / 100
           else v_code.value end
    )::int,
    null::text,
    v_code.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- La orden
-- ---------------------------------------------------------------------------

-- Crea o actualiza la orden de una inscripcion.
--
-- Se puede llamar varias veces: el atleta prueba un codigo, lo cambia, vuelve
-- atras. Mientras la orden no este pagada, se recalcula.
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

  if coalesce(v_registro.price_cents, 0) = 0 then
    raise exception 'Esta inscripción no tiene costo';
  end if;

  select * into v_orden from public.orders where registration_id = p_registration_id;

  if v_orden.status = 'pagada' then
    -- Una orden pagada no se recalcula: el monto que se cobro es historia.
    return v_orden;
  end if;

  select d.descuento_cents, d.motivo, d.code_id
  into v_descuento, v_motivo, v_code_id
  from public.evaluar_descuento(
    v_registro.event_id, v_registro.division_id, p_code, v_registro.price_cents
  ) d;

  if v_motivo is not null then
    raise exception '%', v_motivo;
  end if;

  insert into public.orders (
    event_id, registration_id, amount_cents, currency, discount_code_id, discount_cents
  )
  values (
    v_registro.event_id, p_registration_id, v_registro.price_cents,
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
-- Registrar lo que dijo el proveedor
-- ---------------------------------------------------------------------------

-- Anota un intento y, si viene aprobado, cobra la orden y confirma la inscripcion.
--
-- La llama el webhook (con service role, despues de verificar la firma) y la
-- confirmacion manual de una transferencia. Es IDEMPOTENTE por `external_id`:
-- un webhook que llega tres veces deja un solo intento y cobra una sola vez.
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
    if p_status = 'rechazado' and v_orden.status = 'pendiente' then
      update public.orders set status = 'fallida', provider = p_provider
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

-- La organizacion marca una transferencia como recibida.
--
-- No desaparece cuando entren las pasarelas: la transferencia bancaria se sigue
-- usando, y alguien tiene que decir que llego.
create or replace function public.confirmar_pago_manual(
  p_order_id uuid,
  p_referencia text default null
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

  if not coalesce(public.can_manage_event(v_orden.event_id), false) then
    raise exception 'Solo la organización puede confirmar un pago'
      using errcode = 'insufficient_privilege';
  end if;

  return public.registrar_intento_de_pago(
    p_order_id,
    'transferencia',
    'aprobado',
    -- Sin id externo la idempotencia la da el id de la orden: confirmar dos
    -- veces la misma transferencia no anota dos intentos.
    coalesce(nullif(trim(coalesce(p_referencia, '')), ''), 'manual-' || p_order_id::text),
    v_orden.total_cents,
    jsonb_build_object('confirmadoPor', auth.uid(), 'referencia', p_referencia)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Lo que ve quien va a pagar
-- ---------------------------------------------------------------------------
--
-- Devuelve los medios de pago configurados SIN sus secretos: solo lo que la
-- pantalla necesita mostrar. El texto cifrado no sale de la base ni por esta
-- via ni por PostgREST.
create or replace function public.medios_de_pago(p_registration_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pp.id,
    'provider', pp.provider,
    'label', pp.label,
    'publicConfig', pp.public_config,
    -- Si tiene credenciales cargadas. El secreto en si no viaja nunca.
    'configurado', pp.secret_ciphertext is not null
  ) order by pp.provider), '[]'::jsonb)
  from public.registrations r
  join public.events e on e.id = r.event_id
  join public.payment_providers pp on pp.org_id = e.org_id and pp.active
  where r.id = p_registration_id
    and coalesce(public.puede_ver_inscripcion(p_registration_id), false);
$$;

select public.apply_function_lockdown();
