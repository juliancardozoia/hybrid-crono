-- El juez no se entera de un DNF marcado desde la torre de control.
--
-- El sync del juez (`startSyncLoop`) es de SOLO SUBIDA: empuja su cola local
-- de IndexedDB y nunca baja nada. Un DNF insertado por la organizacion desde
-- Control (`marcarDnf`, via `ingest_timing_events` con `deviceId:
-- "panel-organizador"`) queda en el servidor, pero el store del juez arma su
-- estado ENTERO desde su copia local -- nunca vuelve a preguntar -- asi que
-- su reloj sigue corriendo sobre un heat que para el servidor ya termino.
--
-- `judge_lane_events` es lo que le falta: una lectura periodica de "que hay
-- en el log que yo no tengo todavia", scoped igual que `judge_lane_bundle`
-- (cualquier staff del evento, no solo el juez asignado -- mismo criterio que
-- ya usa esa funcion para datos de estructura, y un timing_event no lleva
-- nombres de atletas).
create or replace function public.judge_lane_events(p_lane_id uuid)
returns setof public.timing_events
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select te.*
  from public.timing_events te
  join public.lanes l on l.id = te.lane_id
  where te.lane_id = p_lane_id
    and (public.event_role(l.event_id) is not null or public.event_staff_role(l.event_id) is not null)
  order by te.seq;
$$;

-- Un carril con resultado terminal no tiene nada mas que juzgar. Antes
-- `judge_visible_lanes()` no sabia esto -- `lanes.status` no lo actualiza
-- NADA en todo el codigo, queda pegado en su valor inicial -- asi que
-- listaba el carril para siempre, con un boton manual ("Terminé - liberar")
-- para sacarlo. Ahora se excluye directo: desaparece solo de "tuyos" (nadie
-- tiene que liberarlo a mano) y nunca aparece en "libres" (el resultado de un
-- atleta que ya termino no se re-ofrece para que otro lo tome).
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
  left join public.workouts w on w.id = l.workout_id
  left join public.teams t on t.id = l.team_id
  left join public.divisions d on d.id = t.division_id
  where (public.event_role(l.event_id) is not null or public.event_staff_role(l.event_id) is not null)
    and not coalesce(
      (select r.status in ('finished', 'dnf', 'dq') from public.results r where r.lane_id = l.id),
      false
    )
    and not (
      exists (select 1 from public.workout_scores ws where ws.lane_id = l.id)
      and not exists (
        select 1 from public.workout_scores ws
        where ws.lane_id = l.id and ws.status not in ('valido', 'capeado', 'dnf', 'dq')
      )
    )
  order by l.lane_number;
$$;

select public.apply_function_lockdown();
