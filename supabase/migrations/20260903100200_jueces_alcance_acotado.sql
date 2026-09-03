-- Un juez de EVENTO no ve la competencia: ve su carril.
--
-- EL HUECO
--
-- `event_role()` traducia `event_staff_role = 'judge'` a `org_role = 'judge'`,
-- exactamente el mismo valor que ya usaban los miembros de ORGANIZACION con
-- rol de juez. Pero un miembro de organizacion es alguien de confianza del
-- box; un juez invitado a UN evento puede ser un desconocido contratado para
-- esa fecha. La traduccion le daba a ese desconocido el mismo acceso de
-- LECTURA que a un miembro de la organizacion sobre TREINTA tablas -- las
-- mismas politicas RLS que dicen `event_role(event_id) is not null`,
-- documentadas como "un solo helper, no reescribas treinta politicas" --
-- incluidas `divisions`, `athletes`, `teams`, `results`, `standings`,
-- `workout_scores`, `event_documents`, `discount_codes`. Y como `event_role()`
-- tambien es lo que usa `requireEventAccess()` para decidir si mostrar el
-- panel, ese mismo juez podia navegar directo a `/panel/eventos/[id]/atletas`
-- o `/divisiones` y ver la ficha entera de la competencia -- exactamente lo
-- que un tester reporto al invitar un juez de prueba.
--
-- LA REGLA NUEVA
--
-- `event_staff_role = 'judge'` deja de traducirse a NINGUN org_role. Sin
-- org_role, `event_role(event_id)` devuelve null para ese usuario en ESE
-- evento -- y con eso: `requireEventAccess()` lo rebota del panel entero (la
-- misma redireccion que ya usa para un desconocido total), y las ~25 politicas
-- `event_role(event_id) is not null` dejan de dejarlo pasar.
--
-- Los otros roles de `event_staff` NO cambian: `manager`, `verifier`,
-- `scorekeeper` y `registrar` siguen traduciendose igual que hoy. Son roles
-- que la organizacion elige a proposito para alguien que SI necesita
-- configurar o revisar la competencia; "juez" es el default de quien solo
-- llega a tomar un carril, y es sobre ese caso especifico que se reporto el
-- problema.
--
-- LO QUE UN JUEZ SI NECESITA SEGUIR VIENDO
--
-- La pantalla /juez (elegir carril, cronometrar) SI necesita leer datos: que
-- carriles hay, el heat, el circuito, las penalizaciones, los movimientos del
-- WOD. Nada de eso es informacion personal. Se resuelve de dos maneras:
--
--   1. Las tablas de ESTRUCTURA (sin datos personales de nadie) --
--      `lanes`, `heats`, `workout_parts`, `part_divisions`, `segments`,
--      `penalty_types`, `part_blocks`, `part_movements`,
--      `division_movement_specs` -- se abren con `puede_leer_evento()`, que
--      es `event_role() is not null OR event_staff_role() is not null`: un
--      juez de evento pasa por la segunda mitad, todo lo demas por la
--      primera, sin duplicar treinta condiciones distintas.
--
--   2. Lo que SI tiene datos personales -- nombre de atleta, que sale de
--      `athletes`, `teams` y `team_members` -- NO se abre por RLS de tabla:
--      RLS es por FILA, no por COLUMNA, asi que abrir `athletes` para poder
--      mostrar "Juan Perez" en la tarjeta del carril tambien abriria su fecha
--      de nacimiento, documento, telefono y pais a quien pida `select=*` por
--      la API en vez de por la app. `judge_visible_lanes()` y
--      `judge_lane_bundle()` son `security definer`: hacen el join adentro,
--      donde SI pueden leer esas tablas, y devuelven solo el nombre ya
--      concatenado. Reemplazan los `.from("lanes").select("... teams
--      (... athletes (...))")` que hacian antes `getJudgeLanes()` y
--      `fetchLaneBundle()` -- mismo dato final en la pantalla, cero acceso
--      directo de un juez de evento a la tabla de atletas.
--
-- `lanes` y `heats` en cambio SI se abren por RLS ademas de por las funciones
-- de arriba: `recomputeLanes()` (la ruta que recalcula resultados al
-- sincronizar) resuelve el carril con el cliente del USUARIO a proposito --
-- "ya verificamos que el carril es suyo" es RLS, no una funcion -- y esas dos
-- tablas no tienen ninguna columna personal.

create or replace function public.event_role(p_event_id uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select m.role from public.events e
      join public.org_members m on m.org_id = e.org_id
      where e.id = p_event_id and m.user_id = auth.uid()
    ),
    case public.event_staff_role(p_event_id)
      when 'manager' then 'admin'::public.org_role
      when 'verifier' then 'head_judge'::public.org_role
      when 'scorekeeper' then 'judge'::public.org_role
      when 'registrar' then 'judge'::public.org_role
      -- 'judge' NO se traduce a ningun org_role: ver el comentario grande de
      -- esta migracion. Es la unica linea que cambia respecto de antes.
      else null
    end
  );
$$;

-- Puede leer la ESTRUCTURA operativa de un evento -- lo que necesita /juez
-- para cronometrar, nada de lo que necesita el panel de configuracion.
create or replace function public.puede_leer_evento(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.event_role(p_event_id) is not null
    or public.event_staff_role(p_event_id) is not null,
    false
  );
$$;

alter policy lanes_read on public.lanes
  using (public.puede_leer_evento(event_id));

alter policy heats_read on public.heats
  using (public.puede_leer_evento(event_id));

alter policy workout_parts_read on public.workout_parts
  using (public.puede_leer_evento(event_id));

alter policy part_divisions_read on public.part_divisions
  using (public.puede_leer_evento(event_id));

alter policy segments_read on public.segments
  using (public.puede_leer_evento(event_id));

alter policy penalty_types_read on public.penalty_types
  using (public.puede_leer_evento(event_id));

alter policy part_blocks_read on public.part_blocks
  using (public.puede_leer_evento(event_id));

alter policy part_movements_read on public.part_movements
  using (public.puede_leer_evento(event_id));

alter policy division_movement_specs_read on public.division_movement_specs
  using (public.puede_leer_evento(event_id));

-- claim_lane: el gate de pertenencia miraba SOLO event_role(), que ahora
-- devuelve null para un juez de evento aprobado. Se agrega event_staff_role()
-- para volver a admitirlo -- es la MISMA persona que ya podia tomar carril,
-- solo que ya no cuenta como "tiene org_role" para las otras veintipico
-- tablas. El resto de la funcion (un heat a la vez, autoasignacion
-- configurable, alcance por division) no cambia.
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

  if not v_verifica
     and public.event_role(v_event_id) is null
     and public.event_staff_role(v_event_id) is null
  then
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

  select t.division_id into v_division_id
  from public.lanes l
  join public.teams t on t.id = l.team_id
  where l.id = p_lane_id;

  if v_division_id is not null and not public.puede_en_division(v_event_id, v_division_id) then
    raise exception 'No estás habilitado para juzgar esta categoría'
      using errcode = 'insufficient_privilege';
  end if;

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
      judge_id is null
      or judge_id = auth.uid()
      or lease_expires_at < now()
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
-- Los dos caminos que reemplazan el acceso directo a athletes/teams/divisions
-- ---------------------------------------------------------------------------

/** Los carriles que un juez puede ver: los suyos y los libres, sin abrir athletes. */
create or replace function public.judge_visible_lanes()
returns table (
  lane_id uuid,
  lane_number int,
  status public.lane_status,
  judge_id uuid,
  event_id uuid,
  event_name text,
  event_status public.event_status,
  team_id uuid,
  bib_number int,
  team_name text,
  division_name text,
  athletes text,
  heat_id uuid,
  heat_name text,
  heat_started_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.id, l.lane_number, l.status, l.judge_id, l.event_id, e.name, e.status,
    l.team_id, t.bib_number, t.name, d.name,
    (
      select string_agg(a.first_name || ' ' || a.last_name, ' / ' order by a.last_name)
      from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
    ),
    h.id, h.name, h.started_at
  from public.lanes l
  join public.heats h on h.id = l.heat_id
  join public.events e on e.id = l.event_id
  left join public.teams t on t.id = l.team_id
  left join public.divisions d on d.id = t.division_id
  where public.event_role(l.event_id) is not null
     or public.event_staff_role(l.event_id) is not null
  order by l.lane_number;
$$;

/** Todo lo que necesita el bundle offline de UN carril, con el nombre ya armado. */
create or replace function public.judge_lane_bundle(p_lane_id uuid)
returns table (
  event_id uuid,
  event_name text,
  heat_id uuid,
  heat_name text,
  heat_started_at timestamptz,
  lane_number int,
  start_offset_ms int,
  judge_id uuid,
  workout_id uuid,
  bib_number int,
  team_name text,
  athletes text,
  division_id uuid,
  division_name text,
  course_template_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.event_id, e.name, h.id, h.name, h.started_at,
    l.lane_number, l.start_offset_ms, l.judge_id, l.workout_id,
    t.bib_number, t.name,
    (
      select string_agg(a.first_name || ' ' || a.last_name, ' / ' order by a.last_name)
      from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
    ),
    d.id, d.name, d.course_template_id
  from public.lanes l
  join public.heats h on h.id = l.heat_id
  join public.events e on e.id = l.event_id
  left join public.teams t on t.id = l.team_id
  left join public.divisions d on d.id = t.division_id
  where l.id = p_lane_id
    and (public.event_role(l.event_id) is not null or public.event_staff_role(l.event_id) is not null);
$$;

select public.apply_function_lockdown();
