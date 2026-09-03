-- Jueces: postulacion publica, aprobacion, autoasignacion configurable y
-- un juez en un solo carril a la vez.
--
-- CUATRO HUECOS QUE ESTA MIGRACION CIERRA
--
-- 1. Hasta ahora la UNICA puerta de entrada de un juez era la invitacion del
--    organizador. Un juez que encuentra la competencia en el catalogo no tenia
--    forma de ofrecerse: tiene que poder POSTULARSE, y esa postulacion tiene
--    que quedar pendiente hasta que alguien de la organizacion la revise.
--
-- 2. `claim_lane` dejaba pasar a CUALQUIERA con `event_role(event_id) is not
--    null` -- que hoy es cualquier fila de `event_staff`, aprobada o no. La
--    postulacion publica necesitaba, ademas, algo que la bloqueara hasta que
--    la organizacion la aprobara: "siempre verificado por la organizacion".
--
-- 3. Nada impedia que un juez tomara diez carriles a la vez. En la practica
--    nadie puede cronometrar dos heats en simultaneo, y no habia forma de
--    impedirlo desde la base.
--
-- 4. `transfer_lane` exigia `can_verify_event` incluso para que un juez
--    soltara SU PROPIO carril -- `releaseLane` (src/features/judge/actions.ts)
--    ya intentaba hacer exactamente eso, en silencio, y fallaba siempre: un
--    juez comun nunca tiene `can_verify_event`. Sin poder soltar su carril, no
--    hay forma de "terminar este heat para estar en otro" salvo esperar a que
--    venza el lease (6 horas por defecto).
--
-- LA PIEZA QUE HACE FUNCIONAR TODO LO DEMAS: `approved_at`
--
-- Una invitacion del organizador sigue aprobandose SOLA -- el organizador ya
-- eligio a esa persona escribiendo su correo, no hace falta un segundo paso.
-- Una postulacion publica arranca SIN aprobar. `event_staff_role()` -- de la
-- que cuelga `event_role()` y con el toda la cadena de RLS -- ahora exige
-- `approved_at is not null`. No hace falta tocar las treinta politicas que ya
-- confian en `event_role()`: todas heredan la garantia en el mismo lugar
-- donde ya la resolvian.

alter table public.event_staff
  add column approved_at timestamptz;

-- Todo lo que ya existe se dio de alta por invitacion del organizador: quedo
-- aprobado desde siempre, y esta migracion no le cambia el comportamiento a
-- nadie que ya estuviera cargado.
update public.event_staff
set approved_at = coalesce(accepted_at, created_at)
where approved_at is null;

alter table public.events
  -- Si el juez puede tomar su propio carril desde /juez, o si SOLO la
  -- organizacion puede asignarlo con transfer_lane. Configurable por
  -- competencia: hay organizadores que prefieren asignar todo de antemano.
  add column allow_judge_self_claim boolean not null default true;

-- ---------------------------------------------------------------------------
-- event_staff_role: ahora exige aprobacion
-- ---------------------------------------------------------------------------

create or replace function public.event_staff_role(p_event_id uuid)
returns public.event_staff_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.role from public.event_staff s
  where s.event_id = p_event_id
    and s.user_id = auth.uid()
    and s.approved_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- invite_event_staff: la invitacion del organizador aprueba sola
-- ---------------------------------------------------------------------------

create or replace function public.invite_event_staff(
  p_event_id uuid,
  p_email text,
  p_role public.event_staff_role default 'judge',
  p_is_admin boolean default false,
  p_can_edit_registrations boolean default false,
  p_can_delete_registrations boolean default false,
  p_can_edit_scores boolean default false,
  p_can_manage_workouts boolean default false,
  p_divisions uuid[] default null
)
returns public.event_staff
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(trim(p_email));
  v_fila public.event_staff;
  v_role public.event_staff_role := p_role;
begin
  if not coalesce(public.can_manage_event(p_event_id), false) then
    raise exception 'Solo la organización puede invitar colaboradores'
      using errcode = 'insufficient_privilege';
  end if;

  if position('@' in v_email) < 2 then
    raise exception 'El correo no es válido';
  end if;

  if p_is_admin then
    v_role := 'manager';
  end if;

  insert into public.event_staff (
    event_id, invited_email, role, invited_by, user_id, accepted_at, approved_at,
    is_admin, can_edit_registrations, can_delete_registrations,
    can_edit_scores, can_manage_workouts
  )
  values (
    p_event_id, v_email, v_role, auth.uid(),
    (select id from public.profiles where lower(email) = v_email),
    case when exists (select 1 from public.profiles where lower(email) = v_email)
         then now() else null end,
    -- La organizacion invito a esta persona a proposito: no hace falta un
    -- segundo click para aprobarla.
    now(),
    p_is_admin,
    p_is_admin or coalesce(p_can_edit_registrations, false),
    p_is_admin or coalesce(p_can_delete_registrations, false),
    p_is_admin or coalesce(p_can_edit_scores, false),
    p_is_admin or coalesce(p_can_manage_workouts, false)
  )
  on conflict (event_id, lower(invited_email)) do update set
    role = excluded.role,
    approved_at = coalesce(public.event_staff.approved_at, now()),
    is_admin = excluded.is_admin,
    can_edit_registrations = excluded.can_edit_registrations,
    can_delete_registrations = excluded.can_delete_registrations,
    can_edit_scores = excluded.can_edit_scores,
    can_manage_workouts = excluded.can_manage_workouts
  returning * into v_fila;

  delete from public.event_staff_divisions where staff_id = v_fila.id;

  if not p_is_admin and p_divisions is not null and array_length(p_divisions, 1) > 0 then
    insert into public.event_staff_divisions (staff_id, division_id, event_id)
    select v_fila.id, d.id, p_event_id
    from public.divisions d
    where d.event_id = p_event_id and d.id = any (p_divisions);
  end if;

  return v_fila;
end;
$$;

-- ---------------------------------------------------------------------------
-- La postulacion publica
-- ---------------------------------------------------------------------------

/**
 * Un atleta o cualquier usuario registrado se postula como juez de una
 * competencia PUBLICADA. Queda con `approved_at is null` -- sin acceso a nada
 * todavia -- hasta que la organizacion la apruebe desde /jueces.
 *
 * Se resuelve por SLUG, no por id: es lo que llama la pagina publica del
 * evento, y esa pagina nunca tuvo el uuid interno del evento en su payload.
 */
create or replace function public.apply_as_judge(p_public_slug text)
returns public.event_staff
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_email text;
  v_fila public.event_staff;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión para postularte'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_event_id
  from public.events
  where public_slug = p_public_slug and published_at is not null;

  if v_event_id is null then
    raise exception 'Esta competencia no recibe postulaciones de jueces';
  end if;

  select email into v_email from public.profiles where id = auth.uid();

  if v_email is null then
    raise exception 'Tu perfil no tiene un correo cargado';
  end if;

  if exists (
    select 1 from public.event_staff
    where event_id = v_event_id and lower(invited_email) = lower(v_email)
  ) then
    raise exception 'Ya estás postulado, invitado o participas en esta competencia';
  end if;

  insert into public.event_staff (
    event_id, invited_email, role, invited_by, user_id, accepted_at, approved_at
  )
  values (
    v_event_id, v_email, 'judge', auth.uid(), auth.uid(), now(), null
  )
  returning * into v_fila;

  return v_fila;
end;
$$;

/** La organizacion aprueba una postulacion publica (o revalida cualquier fila). */
create or replace function public.approve_event_staff(p_staff_id uuid)
returns public.event_staff
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_fila public.event_staff;
begin
  select event_id into v_event_id from public.event_staff where id = p_staff_id;

  if v_event_id is null then
    raise exception 'La postulación no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'Solo la organización puede aprobar colaboradores'
      using errcode = 'insufficient_privilege';
  end if;

  update public.event_staff
  set approved_at = now()
  where id = p_staff_id
  returning * into v_fila;

  return v_fila;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_lane: verificado, un carril a la vez, y respeta la autoasignacion
-- ---------------------------------------------------------------------------

create or replace function public.claim_lane(
  p_lane_id uuid,
  p_lease_minutes int default 360
)
returns public.lanes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lane public.lanes;
  v_event_id uuid;
  v_previous uuid;
  v_verifica boolean;
  v_permite_autoasignacion boolean;
  v_division_id uuid;
  v_otro record;
begin
  select event_id, judge_id into v_event_id, v_previous
  from public.lanes where id = p_lane_id;

  if v_event_id is null then
    raise exception 'El carril no existe';
  end if;

  v_verifica := public.can_verify_event(v_event_id);

  -- event_role() ya exige `approved_at` para un colaborador de evento: una
  -- postulacion sin aprobar no tiene rol, y no llega mas alla de esta linea.
  -- Es la garantia de "siempre verificado por la organizacion".
  if not v_verifica and public.event_role(v_event_id) is null then
    raise exception 'No perteneces a este evento, o tu postulación todavía no fue aprobada'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_verifica then
    select allow_judge_self_claim into v_permite_autoasignacion
    from public.events where id = v_event_id;

    if not coalesce(v_permite_autoasignacion, true) then
      raise exception 'La organización desactivó la autoasignación de carriles: pídele a un organizador que te asigne uno'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- El alcance por categoria, si el colaborador tiene uno. Sin filas de
  -- alcance (el caso comun) puede con cualquier carril.
  select t.division_id into v_division_id
  from public.lanes l
  join public.teams t on t.id = l.team_id
  where l.id = p_lane_id;

  if v_division_id is not null and not public.puede_en_division(v_event_id, v_division_id) then
    raise exception 'No estás habilitado para juzgar esta categoría'
      using errcode = 'insufficient_privilege';
  end if;

  -- "Debe terminar este HEAT para estar en otro": el limite es el heat, no el
  -- carril. Un juez puede cubrir varios carriles del MISMO heat -- son atletas
  -- corriendo delante suyo al mismo tiempo, y es como trabaja hoy una
  -- competencia chica -- pero no puede tener un carril activo en un heat
  -- distinto: eso es estar en dos lugares a la vez, que es exactamente lo que
  -- ya detecta (sin bloquear) el codigo `juez_solapado` de
  -- event_schedule_issues. Un lease vencido cuenta como heat abandonado, no
  -- como "en curso".
  select l.id, h.name as heat_name, l.lane_number
  into v_otro
  from public.lanes l
  left join public.heats h on h.id = l.heat_id
  where l.judge_id = auth.uid()
    and l.heat_id <> (select l2.heat_id from public.lanes l2 where l2.id = p_lane_id)
    and l.lease_expires_at > now()
  limit 1;

  if v_otro.id is not null then
    raise exception 'Ya tienes un carril activo en otro heat (% · carril %): termínalo antes de tomar este',
      coalesce(v_otro.heat_name, 'otro heat'), v_otro.lane_number
      using errcode = 'lock_not_available';
  end if;

  update public.lanes
  set judge_id = auth.uid(),
      claimed_at = now(),
      lease_expires_at = now() + make_interval(mins => p_lease_minutes)
  where id = p_lane_id
    and (
      judge_id is null                 -- libre
      or judge_id = auth.uid()         -- ya es mio: reclamar de nuevo es inofensivo
      or lease_expires_at < now()      -- el juez anterior lo abandono
    )
  returning * into v_lane;

  if v_lane.id is null then
    raise exception 'El carril ya lo tomó otro juez'
      using errcode = 'lock_not_available';
  end if;

  if v_previous is distinct from auth.uid() then
    insert into public.lane_audit (lane_id, event_id, action, actor_id, previous_judge_id, new_judge_id)
    values (p_lane_id, v_event_id, 'claim', auth.uid(), v_previous, auth.uid());
  end if;

  return v_lane;
end;
$$;

-- ---------------------------------------------------------------------------
-- transfer_lane: el juez actual puede soltar SU carril, y el destino se
-- valida contra event_staff aprobado ademas de org_members
-- ---------------------------------------------------------------------------

create or replace function public.transfer_lane(
  p_lane_id uuid,
  p_to_judge uuid,
  p_reason text default null
)
returns public.lanes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lane public.lanes;
  v_event_id uuid;
  v_previous uuid;
  v_autoliberacion boolean;
begin
  select event_id, judge_id into v_event_id, v_previous
  from public.lanes where id = p_lane_id;

  if v_event_id is null then
    raise exception 'El carril no existe';
  end if;

  -- El juez actual puede soltar SU PROPIO carril sin pasar por la
  -- organizacion -- es lo que le permite terminar un heat y tomar otro sin
  -- esperar seis horas a que venza el lease. No puede REASIGNARLO a un
  -- tercero: eso sigue siendo trabajo de quien verifica.
  v_autoliberacion := p_to_judge is null and v_previous is not null and v_previous = auth.uid();

  if not v_autoliberacion and not public.can_verify_event(v_event_id) then
    raise exception 'Solo el juez principal o la organización pueden transferir un carril'
      using errcode = 'insufficient_privilege';
  end if;

  -- No se puede transferir un carril a alguien ajeno al evento: seria darle
  -- acceso de escritura a los tiempos por la puerta de atras. Antes esto
  -- miraba solo org_members y dejaba afuera a un colaborador invitado SOLO a
  -- este evento -- que es justo a quien mas se le asignan carriles.
  if p_to_judge is not null and not exists (
    select 1
    from public.org_members m
    join public.events e on e.org_id = m.org_id
    where e.id = v_event_id and m.user_id = p_to_judge
    union all
    select 1
    from public.event_staff s
    where s.event_id = v_event_id and s.user_id = p_to_judge and s.approved_at is not null
  ) then
    raise exception 'El juez destino no pertenece a este evento, o su postulación todavía no fue aprobada';
  end if;

  update public.lanes
  set judge_id = p_to_judge,
      claimed_at = case when p_to_judge is null then null else now() end,
      lease_expires_at = case when p_to_judge is null then null else now() + interval '6 hours' end
  where id = p_lane_id
  returning * into v_lane;

  insert into public.lane_audit (
    lane_id, event_id, action, actor_id, previous_judge_id, new_judge_id, reason
  )
  values (
    p_lane_id, v_event_id,
    case when p_to_judge is null then 'release' else 'transfer' end,
    auth.uid(), v_previous, p_to_judge, p_reason
  );

  return v_lane;
end;
$$;

select public.apply_function_lockdown();
