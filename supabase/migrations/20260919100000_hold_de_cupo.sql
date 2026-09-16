-- Reserva de cupo con expiracion, y el lock que la hace atomica.
--
-- EL PROBLEMA EXACTO
--
-- `cupos_disponibles()` cuenta `registrations` con status en ('confirmada',
-- 'esperando_pago'). Una fila en 'borrador'/'esperando_integrantes' NO
-- cuenta -- asi que el momento real en que se "reserva" el ultimo cupo no es
-- cuando alguien empieza el tramite (`start_registration`), es cuando pasa a
-- 'esperando_pago' o se confirma directo (`submit_registration`) o cuando se
-- confirma por otro camino (`confirm_registration`, alta manual incluida).
-- Esos dos puntos leian `cupos_disponibles()` como un SELECT comun, sin
-- ningun lock -- dos transacciones concurrentes podian leer las dos "1
-- cupo libre" y las dos pasar, vendiendo el mismo lugar dos veces.
--
-- LA SOLUCION: UN LOCK POR FILA, NO UNA TABLA DE CONTADORES NUEVA
--
-- `division_registration` ya existe (PK = division_id) y ya se lee en el
-- mismo flujo. `select ... for update` sobre esa fila, ANTES de contar,
-- serializa por CATEGORIA: una segunda transaccion que intente lo mismo
-- para la MISMA categoria espera a que la primera termine (commit o
-- rollback) antes de poder leer el cupo. Categorias distintas nunca se
-- bloquean entre si. Si la categoria no tiene fila en `division_registration`
-- (sin precio/cupo configurado), el `for update` no bloquea nada -- no hay
-- nada que reservar.
--
-- QUE ES `hold_expires_at`
--
-- Cuando una inscripcion pasa a 'esperando_pago', se le pone
-- `hold_expires_at = now() + 15 minutos` (default global, no configurable
-- por evento todavia). Mientras el hold este vigente, la fila cuenta como
-- cupo ocupado -- exactamente como antes. Vencido, deja de contar SIN que
-- nadie la cancele: el tramite sigue existiendo, solo que ya no bloquea el
-- ultimo lugar a otro atleta. Si el atleta vuelve a intentar pagar
-- (`upsert_order`), se revisa si el cupo sigue disponible y se renueva el
-- hold; si ya no hay lugar, se le informa en vez de dejarlo pagar por un
-- cupo que ya se le dio a otro.

alter table public.registrations add column hold_expires_at timestamptz;

comment on column public.registrations.hold_expires_at is
  'Hasta cuando esta fila cuenta como cupo ocupado mientras status=esperando_pago. Vencido, cupos_disponibles() deja de contarla -- el tramite NO se cancela solo, ver el plan de rediseño (Fase 5).';

-- ---------------------------------------------------------------------------
-- cupos_disponibles: un hold vencido no ocupa cupo
-- ---------------------------------------------------------------------------
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
        and (
          r.status = 'confirmada'
          or (r.status = 'esperando_pago'
              and (r.hold_expires_at is null or r.hold_expires_at > now()))
        )
    ))
  end
  from public.division_registration dr
  where dr.division_id = p_division_id;
$$;

-- ---------------------------------------------------------------------------
-- submit_registration: lock + reserva real del cupo
-- ---------------------------------------------------------------------------
--
-- Copia de la version vigente (20260916110000_pago_verificado_de_verdad.sql)
-- con el lock agregado justo antes de pasar a 'esperando_pago' -- es el
-- momento exacto en que esta fila empieza a contar para cupos_disponibles(),
-- asi que es el momento exacto en que hay que serializar contra cualquier
-- otra transaccion haciendo lo mismo para la misma categoria.
create or replace function public.submit_registration(p_registration_id uuid)
returns public.registrations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
  v_precio public.division_registration;
  v_ocupados int;
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

  if coalesce(v_registro.price_cents, 0) = 0 then
    perform public.upsert_order(p_registration_id);
    return public.confirm_registration(p_registration_id);
  end if;

  -- Lock atomico por categoria -- ver el comentario de arriba del archivo.
  select * into v_precio from public.division_registration
  where division_id = v_registro.division_id
  for update;

  if v_precio.capacity is not null then
    select count(*) into v_ocupados from public.registrations
    where division_id = v_registro.division_id
      and id <> p_registration_id
      and (
        status = 'confirmada'
        or (status = 'esperando_pago'
            and (hold_expires_at is null or hold_expires_at > now()))
      );
    if v_ocupados >= v_precio.capacity then
      raise exception 'Esta categoría no tiene cupos disponibles';
    end if;
  end if;

  update public.registrations
  set status = 'esperando_pago', hold_expires_at = now() + interval '15 minutes'
  where id = p_registration_id
  returning * into v_registro;

  return v_registro;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_registration: mismo lock para los caminos que no pasan por
-- 'esperando_pago' (gratis directo, alta manual)
-- ---------------------------------------------------------------------------
--
-- Copia de la version vigente (20260904400000_alta_manual_estado_box_talla.sql),
-- reemplazando el chequeo de cupo SIN LOCK (`v_cupos :=
-- cupos_disponibles(...)`) por el mismo lock atomico. Se salta cuando la
-- inscripcion YA esta en 'esperando_pago': ese cupo lo reservo el lock de
-- `submit_registration` -- volver a pelear por el lock aca podria rechazar
-- un pago legitimo si mientras tanto otras altas llenaron la categoria, que
-- es exactamente el caso que la excepcion siempre existio para cubrir.
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
  v_precio public.division_registration;
  v_ocupados int;
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
     and not coalesce(public.can_register_event(v_registro.event_id), false) then
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

  if v_registro.status <> 'esperando_pago' then
    select * into v_precio from public.division_registration
    where division_id = v_registro.division_id
    for update;

    if v_precio.capacity is not null then
      select count(*) into v_ocupados from public.registrations
      where division_id = v_registro.division_id
        and id <> p_registration_id
        and (
          status = 'confirmada'
          or (status = 'esperando_pago'
              and (hold_expires_at is null or hold_expires_at > now()))
        );
      if v_ocupados >= v_precio.capacity then
        raise exception 'Esta categoría no tiene cupos disponibles';
      end if;
    end if;
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
      country, document_id, state_province, box, shirt_size
    )
    values (
      v_registro.event_id, v_integrante.first_name, v_integrante.last_name,
      v_integrante.birth_date, v_integrante.gender, v_integrante.invited_email,
      v_integrante.phone, v_integrante.profile_id,
      v_integrante.country, v_integrante.document_id, v_integrante.state_province,
      v_integrante.box, v_integrante.shirt_size
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

-- ---------------------------------------------------------------------------
-- upsert_order: renueva el hold cuando el atleta vuelve a intentar pagar
-- ---------------------------------------------------------------------------
--
-- Copia de la version vigente (20260916110000_pago_verificado_de_verdad.sql)
-- con la renovacion agregada ANTES de armar la orden: es el momento en que
-- el atleta esta activamente tratando de pagar, asi que es el momento
-- correcto para confirmar que el cupo sigue siendo suyo (si el hold vencio,
-- puede que ya no lo sea) y renovarlo otros 15 minutos si sigue.
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
  v_precio public.division_registration;
  v_ocupados int;
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

  -- Renovar el cupo: solo aplica al tramite que de verdad esta reservando un
  -- lugar (esperando_pago, con costo). El armado inicial de la orden en $0
  -- (evento gratis, o alta manual sin costo) no reserva nada -- no hay
  -- nada que renovar.
  if coalesce(v_registro.price_cents, 0) > 0 and v_registro.status = 'esperando_pago' then
    select * into v_precio from public.division_registration
    where division_id = v_registro.division_id
    for update;

    if v_precio.capacity is not null then
      select count(*) into v_ocupados from public.registrations
      where division_id = v_registro.division_id
        and id <> p_registration_id
        and (
          status = 'confirmada'
          or (status = 'esperando_pago'
              and (hold_expires_at is null or hold_expires_at > now()))
        );
      if v_ocupados >= v_precio.capacity then
        raise exception 'Esta categoría se llenó mientras completabas tu inscripción. Elegí otra categoría o contactá a la organización.';
      end if;
    end if;

    update public.registrations
    set hold_expires_at = now() + interval '15 minutes'
    where id = p_registration_id;
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

select public.apply_function_lockdown();
