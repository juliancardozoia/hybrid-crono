-- El juez sabe QUE prueba esta juzgando.
--
-- Ninguna de las dos funciones devolvia el nombre del workout, asi que el
-- selector de carril decia "Heat 2 · Individual Masculino" y la pantalla del
-- cronometro tampoco lo mencionaba. Con una sola prueba por competencia eso no
-- importaba —era la unica— pero un CrossFit corre tres o cuatro, y "¿cual de
-- las tres es esta?" es la primera pregunta del dia.
--
-- EL DROP ES OBLIGATORIO. Agregarle una columna a un `returns table` no lo hace
-- `create or replace`: Postgres responde "cannot change return type of existing
-- function". Y un `drop` se lleva los `revoke` puestos y recrea la funcion con
-- EXECUTE para PUBLIC — por eso el archivo cierra con
-- `apply_function_lockdown()`, que es lo unico que las vuelve a cerrar.

drop function if exists public.judge_visible_lanes();

/** Los carriles que un juez puede ver: los suyos y los libres, sin abrir athletes. */
create function public.judge_visible_lanes()
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
  heat_started_at timestamptz,
  workout_name text
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
    h.id, h.name, h.started_at, w.name
  from public.lanes l
  join public.heats h on h.id = l.heat_id
  join public.events e on e.id = l.event_id
  -- `left join` y no `join`: la prueba del carril es NOT NULL, pero un join
  -- interno de mas es una forma de que una pantalla quede vacia sin decir por
  -- que, y esta es la pantalla con la que un juez entra a trabajar.
  left join public.workouts w on w.id = l.workout_id
  left join public.teams t on t.id = l.team_id
  left join public.divisions d on d.id = t.division_id
  where public.event_role(l.event_id) is not null
     or public.event_staff_role(l.event_id) is not null
  order by l.lane_number;
$$;

drop function if exists public.judge_lane_bundle(uuid);

/** Todo lo que necesita el bundle offline de UN carril, con el nombre ya armado. */
create function public.judge_lane_bundle(p_lane_id uuid)
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
  workout_name text,
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
    l.lane_number, l.start_offset_ms, l.judge_id, l.workout_id, w.name,
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
  left join public.workouts w on w.id = l.workout_id
  left join public.teams t on t.id = l.team_id
  left join public.divisions d on d.id = t.division_id
  where l.id = p_lane_id
    and (public.event_role(l.event_id) is not null or public.event_staff_role(l.event_id) is not null);
$$;

select public.apply_function_lockdown();
