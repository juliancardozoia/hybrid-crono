-- Un atleta inscripto en la competencia no podia ver ni su propio resultado
-- si el organizador estaba en plan gratuito y el evento todavia no llegaba al
-- STATUS 'published' (el que cierra oficialmente -- no `published_at` del
-- catalogo, ver "Publicar no es lo mismo que estar en vivo" en CLAUDE.md).
--
-- `public_scoreboard()` / `public_leaderboard()` / `public_event_info()` son
-- la puerta del PUBLICO ANONIMO -- proyector, catalogo, espectadores -- y el
-- gate de plan existe para eso: "no se restringe cronometrar, se restringe
-- exhibir". Pero las mismas tres funciones son TAMBIEN el unico camino que usa
-- `/en-vivo/[slug]/atleta/[bib]`, el link que el propio atleta abre desde
-- `/panel`. Sin distincion, alguien inscripto en una competencia gratuita
-- nunca podia consultar en que quedo -- ni su categoria, ni el detalle -- hasta
-- que el organizador cerrara oficialmente el evento semanas despues.
--
-- El bypass usa EXACTAMENTE el mismo criterio que ya usan `divisions_read`,
-- `events_read` y `teams_read` (fase "un atleta tambien puede leer su propia
-- competencia"): quien administra el evento (`puede_leer_evento`), o quien es
-- integrante de una inscripcion en el (`es_integrante_de`), ve el documento
-- COMPLETO sin importar plan ni status. No es una ventana mas angosta que la
-- publica -- es la MISMA forma, solo sin gate -- porque el leaderboard de una
-- categoria por definicion muestra a los demas competidores, no solo a quien
-- pregunta: es lo que pide "consultar de que quedo en su categoria".
create or replace function public.puede_ver_resultados_propios(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.puede_leer_evento(p_event_id)
    or exists (
      select 1 from public.registrations r
      where r.event_id = p_event_id and public.es_integrante_de(r.id)
    ),
    false
  );
$$;

-- `scoreboard_document` tiene su PROPIO guard interno (20260909200000): lo
-- necesita porque no es `public_*` y por lo tanto cualquier autenticado puede
-- invocarla directo por REST con un `p_event_id` a mano, salteando por
-- completo a `public_scoreboard`. Ese guard solo dejaba pasar a `puede_leer_evento`
-- (staff) -- sin tocarlo, un integrante seguiria topandose con "no" ADENTRO de
-- `scoreboard_document`, aunque `public_scoreboard` ya lo dejara pasar.
-- `puede_ver_resultados_propios` incluye `puede_leer_evento`, asi que
-- reemplazarlo entero no le quita nada a quien ya pasaba.
create or replace function public.scoreboard_document(
  p_event_id uuid,
  p_detalle boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.event_status;
  v_plan public.org_plan;
begin
  select e.status, o.plan
  into v_status, v_plan
  from public.events e
  join public.organizations o on o.id = e.org_id
  where e.id = p_event_id;

  if v_status is null then
    return null;
  end if;

  if not (
    public.puede_ver_resultados_propios(p_event_id)
    or (v_plan = 'pro' and v_status in ('live', 'verifying', 'published'))
    or (v_plan = 'free' and v_status = 'published')
  ) then
    return null;
  end if;

  return jsonb_build_object(
    -- Se mantiene en 5: este cambio es de ACCESO, no de forma.
    'version', 5,
    'detalle', p_detalle,
    'event', (
      select jsonb_build_object(
        'name', e.name,
        'venue', e.venue,
        'status', e.status,
        'format', e.format,
        'official', e.status = 'published',
        'tiePointPolicy', e.tie_point_policy
      )
      from public.events e where e.id = p_event_id
    ),
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
      from public.divisions d
      where d.event_id = p_event_id
    ), '[]'::jsonb),
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'divisionId', sn.division_id,
        'stage', sn.stage,
        'points', sn.points,
        'locked', sn.locked_at is not null,
        'tiePointPolicy', sn.tie_point_policy
      ))
      from public.scoring_snapshots sn
      join public.divisions d on d.id = sn.division_id
      where d.event_id = p_event_id
    ), '[]'::jsonb),
    'stageAdvancements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'divisionId', sa.division_id,
        'stage', sa.stage,
        'teamId', sa.team_id
      ))
      from public.stage_advancements sa
      where sa.event_id = p_event_id
    ), '[]'::jsonb),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'workoutId', w.id,
        'workoutName', w.name,
        'label', p.label,
        'orderIndex', w.order_index * 1000 + p.order_index,
        'stage', w.stage,
        'timeScheme', p.time_scheme,
        'scoreUnit', p.score_unit,
        'scoreDir', p.score_dir,
        'capUnit', p.cap_unit,
        'maxPoints', p.max_points,
        'tiebreakUnit', p.tiebreak_unit,
        'tiebreakDir', p.tiebreak_dir,
        'tiebreakPartId', case when p.tiebreak_source = 'otra_prueba' then p.tiebreak_part_id end
      ) order by w.order_index, p.order_index)
      from public.workout_parts p
      join public.workouts w on w.id = p.workout_id
      where p.event_id = p_event_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'partId', pd.part_id,
        'divisionId', pd.division_id
      ))
      from public.part_divisions pd
      where pd.event_id = p_event_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'divisionId', t.division_id,
        'bib', t.bib_number,
        'name', t.name,
        'athletes', (
          select string_agg(a.first_name || ' ' || a.last_name, ' / ' order by a.last_name)
          from public.team_members tm
          join public.athletes a on a.id = tm.athlete_id
          where tm.team_id = t.id
        ),
        'countries', coalesce((
          select jsonb_agg(a.country order by a.last_name)
          from public.team_members tm
          join public.athletes a on a.id = tm.athlete_id
          where tm.team_id = t.id
        ), '[]'::jsonb),
        'box', (
          select string_agg(sub.box, ' / ')
          from (
            select distinct a.box
            from public.team_members tm
            join public.athletes a on a.id = tm.athlete_id
            where tm.team_id = t.id and a.box is not null and a.box <> ''
            order by a.box
          ) sub
        )
      ) order by t.bib_number)
      from public.teams t
      where t.event_id = p_event_id and t.status <> 'withdrawn'
    ), '[]'::jsonb),
    'scores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'partId', ws.part_id,
        'teamId', ws.team_id,
        'status', ws.status,
        'value', ws.value_num,
        'reps', ws.value_reps,
        'capValue', ws.value_cap,
        'tiebreak', ws.tiebreak_value,
        'roundBreakdown', ws.round_breakdown
      ))
      from public.workout_scores ws
      join public.teams t on t.id = ws.team_id
      where ws.event_id = p_event_id and t.status <> 'withdrawn'
    ), '[]'::jsonb),
    'splits', case when p_detalle then coalesce((
      select jsonb_agg(jsonb_build_object(
        'teamId', r.team_id,
        'partId', p.id,
        'splits', r.splits,
        'penaltyMs', r.penalty_ms
      ))
      from public.results r
      join public.lanes l on l.id = r.lane_id
      join public.workout_parts p on p.workout_id = l.workout_id and p.order_index = 0
      where r.event_id = p_event_id and r.team_id is not null
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- `public_scoreboard`: el bypass se evalua ANTES del gate de plan/status y
-- devuelve el documento CON detalle siempre -- lo mismo que ya ve el staff al
-- llamar a `scoreboard_document` directo.
create or replace function public.public_scoreboard(p_public_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_status public.event_status;
  v_plan public.org_plan;
begin
  select e.id, e.status, o.plan
  into v_event_id, v_status, v_plan
  from public.events e
  join public.organizations o on o.id = e.org_id
  where e.public_slug = p_public_slug;

  if v_event_id is null then
    return null;
  end if;

  if public.puede_ver_resultados_propios(v_event_id) then
    return public.scoreboard_document(v_event_id, true);
  end if;

  if v_plan = 'pro' then
    if v_status not in ('live', 'verifying', 'published') then
      return null;
    end if;
    return public.scoreboard_document(v_event_id, true);
  end if;

  -- Plan gratuito: recien cuando el evento cerro, y sin detalle.
  if v_status <> 'published' then
    return null;
  end if;
  return public.scoreboard_document(v_event_id, false);
end;
$$;

-- `public_leaderboard`: mismo criterio, sumado al WHERE. El circuito nunca
-- tuvo gate de PLAN (cronometrar queda afuera del corte, ver CLAUDE.md), solo
-- de status: antes de que un heat largue no hay nada que mostrar. El bypass
-- se agrega ademas de esa condicion, para el dia en que exista la carga manual
-- de circuito y una competencia 100% cargada a mano nunca haga pasar
-- `events.status` de 'ready' (eso solo lo mueve `start_heat()`).
drop function if exists public.public_leaderboard(text);

create function public.public_leaderboard(p_public_slug text)
returns table (
  division_name text,
  bib_number int,
  team_name text,
  athletes text,
  countries jsonb,
  status public.lane_status,
  total_ms int,
  penalty_ms int,
  splits jsonb,
  rank_position bigint,
  official boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    d.name as division_name,
    t.bib_number,
    t.name as team_name,
    (
      select string_agg(a.first_name || ' ' || a.last_name, ' / ' order by a.last_name)
      from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
    ) as athletes,
    coalesce((
      select jsonb_agg(a.country order by a.last_name)
      from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
    ), '[]'::jsonb) as countries,
    r.status,
    r.total_ms,
    r.penalty_ms,
    r.splits,
    rank() over (
      partition by r.division_id
      order by
        case r.status when 'finished' then 0 when 'running' then 1 else 2 end,
        r.total_ms nulls last
    ) as rank_position,
    (e.status = 'published') as official
  from public.events e
  join public.results r on r.event_id = e.id
  join public.teams t on t.id = r.team_id
  join public.divisions d on d.id = r.division_id
  where e.public_slug = p_public_slug
    and (
      e.status in ('live', 'verifying', 'published')
      or public.puede_ver_resultados_propios(e.id)
    );
$$;

-- `public_event_info`: agrega `format` -- lo necesita la pantalla de resultado
-- del atleta para elegir entre el detalle de circuito y el de CrossFit -- y el
-- mismo bypass de status. Agregar una columna cambia el tipo de retorno, asi
-- que hace falta el drop primero (misma leccion que 20260914150000).
drop function if exists public.public_event_info(text);

create function public.public_event_info(p_public_slug text)
returns table (
  name text,
  venue text,
  event_date date,
  status public.event_status,
  format public.event_format,
  official boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.name,
    e.venue,
    e.event_date,
    e.status,
    e.format,
    (e.status = 'published') as official
  from public.events e
  where e.public_slug = p_public_slug
    and (
      e.status in ('live', 'verifying', 'published')
      or public.puede_ver_resultados_propios(e.id)
    );
$$;

select public.apply_function_lockdown();
