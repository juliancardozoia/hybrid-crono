-- verification_queue() seguia devolviendo event_count = 0 para todo carril de
-- CrossFit: `coalesce(r.source_event_count, 0)` solo lee `results.source_event_count`,
-- que unicamente escribe el camino de CIRCUITO (`recomputeLanes` en recompute.ts).
-- Un carril de WOD nunca tiene fila en `results` -corre por `workout_scores`-
-- asi que ese coalesce caia siempre al 0 del final, sin importar cuantos
-- marcajes hubiera en `timing_events`.
--
-- Consecuencia visible en la torre de control: "0 marcajes" durante todo un
-- CrossFit, y como "Deshacer Inicio" solo se oculta cuando
-- `heat.marcajesTotales === 0` (TorreDeHeats.tsx), el boton quedaba visible
-- PARA SIEMPRE en un heat de CrossFit -incluso ya terminado-, porque el conteo
-- nunca dejaba de ser cero.
--
-- El fallback cuenta `timing_events` directo -mismo criterio que
-- `source_event_count = log.length` en recompute.ts, sin filtrar voided- y
-- solo aplica cuando no hay fila en `results` (carril de WOD, o un carril de
-- circuito que todavia no corrio su primer recalculo).
create or replace function public.verification_queue(p_event_id uuid)
returns table (
  lane_id uuid,
  bib_number int,
  division_name text,
  heat_name text,
  status public.lane_status,
  total_ms int,
  verified boolean,
  event_count int,
  voided_count int,
  anomalies jsonb,
  started_offline boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    l.id,
    t.bib_number,
    d.name,
    h.name,
    coalesce(r.status, w.status, l.status),
    r.total_ms,
    (r.verified_at is not null),
    coalesce(
      r.source_event_count,
      (select count(*)::int from public.timing_events te where te.lane_id = l.id)
    ),
    (select count(*)::int from public.timing_events te
     where te.lane_id = l.id and te.voided),
    coalesce(r.anomalies, '[]'::jsonb),
    (h.start_source = 'device_offline')
  from public.lanes l
  join public.heats h on h.id = l.heat_id
  left join public.teams t on t.id = l.team_id
  left join public.divisions d on d.id = t.division_id
  left join public.results r on r.lane_id = l.id
  left join lateral (
    select
      (case
        when bool_or(ws.status = 'dq') then 'dq'
        when bool_or(ws.status = 'dnf') then 'dnf'
        when count(*) filter (where ws.status not in ('valido', 'capeado')) = 0 then 'finished'
        when bool_or(ws.status in ('en_curso', 'valido', 'capeado')) then 'running'
        else 'idle'
      end)::public.lane_status as status
    from public.workout_scores ws
    where ws.lane_id = l.id
    having count(*) > 0
  ) w on true
  where l.event_id = p_event_id
    and l.team_id is not null
    and public.can_verify_event(p_event_id)
  order by d.name, t.bib_number;
$$;

grant execute on function public.verification_queue(uuid) to authenticated;
