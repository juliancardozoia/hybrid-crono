-- Integridad entre inscripcion, pago y equipo.
--
-- Tres huecos encontrados diagnosticando RomanoFest con datos reales.
--
-- 1. UN ATLETA PODIA CONFIRMARSE SOLO UNA CATEGORIA PAGA.
--    `confirm_registration` deja pasar a `created_by = auth.uid()` (lo
--    necesita el camino gratuito: `submit_registration` la llama con la
--    sesion del atleta). Pero nada miraba el precio: un POST a
--    /rest/v1/rpc/confirm_registration con la sesion del atleta materializaba
--    el equipo y le daba dorsal sin pagar. Ahora, con precio y sin orden
--    pagada, solo confirma quien tiene `can_register_event`. El webhook corre
--    con service_role (auth.uid() nulo) y llega con la orden ya pagada.
--
-- 2. "MARCAR COMO PAGADA" SIN ORDEN NO DEJABA RASTRO.
--    Si el atleta nunca abrio la pantalla de pago no hay orden, y el panel
--    llamaba a `confirm_registration` directo: sin referencia, sin quien, y
--    `registration_readiness` quedaba en 'incompleto' para siempre porque
--    exige una orden pagada. `confirmar_pago_de_inscripcion` crea la orden si
--    falta y pasa por `confirmar_pago_manual`, el MISMO camino que una
--    transferencia con orden.
--
--    Y `registration_readiness` deja de exigir la orden pagada a una
--    inscripcion YA confirmada: con (1) cerrado, una inscripcion paga solo
--    llega a 'confirmada' por el webhook, por la organizacion, o por un alta
--    manual (cortesia, efectivo en mano) -- en los tres casos el pago esta
--    resuelto. Es lo que dejaba a las altas manuales en 'incompleto'.
--
-- 3. BORRAR UN ATLETA DEJABA EL TRAMITE CONFIRMADO SIN EQUIPO.
--    `delete_team` borraba el equipo y la FK ponia `registrations.team_id` en
--    null, pero la inscripcion seguia 'confirmada': ocupaba cupo y aparecia
--    como confirmada en Inscripciones. Ahora:
--      - alta manual (`source = 'organizer'`) sin orden pagada: se BORRA. Es
--        carga de datos del organizador; no hay nada que auditar, y dejarla
--        ensucia el padron (fue el caso de un atleta recargado con otro
--        correo).
--      - cualquier otra: se CANCELA. Una autoinscripcion puede tener una
--        orden pagada y sus intentos de pago, y borrar el tramite los
--        borraria en cascada.
--    Backfill: las que ya quedaron asi reciben el mismo trato.

-- ---------------------------------------------------------------------------
-- confirm_registration (copia de 20261008100000 + chequeo de pago)
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

  -- Con precio y sin orden pagada solo confirma la organizacion: ver el punto
  -- 1 del encabezado. service_role (auth.uid() nulo) es el webhook.
  if coalesce(v_registro.price_cents, 0) > 0
     and auth.uid() is not null
     and not coalesce(public.can_register_event(v_registro.event_id), false)
     and not exists (
       select 1 from public.orders o
       where o.registration_id = p_registration_id and o.status = 'pagada'
     ) then
    raise exception 'Esta inscripción tiene costo: se confirma cuando la organización registra el pago'
      using errcode = 'insufficient_privilege';
  end if;

  -- El equipo ya nacio (un reenvio viejo desconfirmo el tramite): solo se
  -- corrige el estado. Materializarlo otra vez duplicaria equipo y dorsal,
  -- y choca con athletes_email_unico.
  if v_registro.team_id is not null and v_registro.status <> 'cancelada' then
    update public.registrations
    set status = 'confirmada', hold_expires_at = null,
        confirmed_at = coalesce(confirmed_at, now())
    where id = p_registration_id
    returning * into v_registro;

    return v_registro;
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
-- confirmar_pago_de_inscripcion: "Marcar como pagada", haya orden o no
-- ---------------------------------------------------------------------------
create or replace function public.confirmar_pago_de_inscripcion(
  p_registration_id uuid,
  p_referencia text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registrations;
  v_orden public.orders;
begin
  select * into v_registro from public.registrations where id = p_registration_id;
  if not found then
    raise exception 'La inscripción no existe';
  end if;

  if not coalesce(public.can_register_event(v_registro.event_id), false) then
    raise exception 'Solo la organización puede confirmar un pago'
      using errcode = 'insufficient_privilege';
  end if;

  if v_registro.status = 'cancelada' then
    raise exception 'Esta inscripción fue cancelada';
  end if;

  -- La orden se crea directo y no con `upsert_order`: aquella renueva la
  -- reserva de cupo y puede rechazar por cupo lleno, y aca la organizacion ya
  -- decidio. Mismo monto congelado que usaria `upsert_order`, sin descuento.
  insert into public.orders (event_id, registration_id, amount_cents, currency)
  values (
    v_registro.event_id, p_registration_id, coalesce(v_registro.price_cents, 0),
    coalesce(v_registro.currency, 'COP')
  )
  on conflict (registration_id) do nothing;

  select * into v_orden from public.orders where registration_id = p_registration_id;

  -- confirmar_pago_manual registra el intento (referencia y quien), paga la
  -- orden y confirma la inscripcion: un solo camino, haya habido orden o no.
  return public.confirmar_pago_manual(v_orden.id, p_referencia);
end;
$$;

-- ---------------------------------------------------------------------------
-- registration_readiness (copia de 20260920100000: el pago solo bloquea
-- mientras la inscripcion no esta confirmada, ver el punto 2)
-- ---------------------------------------------------------------------------
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
    when r.status <> 'confirmada'
         and coalesce(r.price_cents, 0) > 0 and (o.id is null or o.status <> 'pagada')
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

-- ---------------------------------------------------------------------------
-- delete_team (copia de 20260911110000 + el tramite no queda huerfano)
-- ---------------------------------------------------------------------------
create or replace function public.delete_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  select event_id into v_event_id from public.teams where id = p_team_id;
  if v_event_id is null then
    raise exception 'El equipo no existe';
  end if;

  if not coalesce(public.can_manage_event(v_event_id), false) then
    raise exception 'No tenés permiso para quitar equipos de esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  -- Se borran los atletas de ESTE equipo que no tienen ninguna otra fila en
  -- team_members: los que siguen en otro equipo del evento se conservan.
  -- Correr esto ANTES de borrar el equipo es lo que hace que "team_id <>
  -- p_team_id" alcance para detectar "sin equipo" -- el propio team_members
  -- de este equipo todavia existe en este punto.
  delete from public.athletes a
  where a.event_id = v_event_id
    and a.id in (
      select tm.athlete_id from public.team_members tm where tm.team_id = p_team_id
    )
    and not exists (
      select 1 from public.team_members tm2
      where tm2.athlete_id = a.id and tm2.team_id <> p_team_id
    );

  -- El tramite no queda confirmado sin equipo (punto 3 del encabezado). Va
  -- ANTES de borrar el equipo, mientras team_id todavia apunta aca.
  delete from public.registrations r
  where r.team_id = p_team_id
    and r.source = 'organizer'
    and not exists (
      select 1 from public.orders o
      where o.registration_id = r.id and o.status = 'pagada'
    );

  update public.registrations
  set status = 'cancelada', hold_expires_at = null
  where team_id = p_team_id;

  -- Borra el equipo; team_members del equipo cae en cascada (los que
  -- quedaban, de atletas que siguen en otro equipo).
  delete from public.teams where id = p_team_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: los tramites que ya quedaron confirmados sin equipo
-- ---------------------------------------------------------------------------
delete from public.registrations r
where r.status = 'confirmada'
  and r.team_id is null
  and r.source = 'organizer'
  and not exists (
    select 1 from public.orders o
    where o.registration_id = r.id and o.status = 'pagada'
  );

update public.registrations
set status = 'cancelada', hold_expires_at = null
where status = 'confirmada'
  and team_id is null;

select public.apply_function_lockdown();
