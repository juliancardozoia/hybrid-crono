-- Verificacion y publicacion de resultados oficiales.

-- Marca resultados como verificados por la organizacion.
--
-- No cambia ningun tiempo: solo deja constancia de quien los reviso y cuando.
-- Los tiempos siguen saliendo del log, que nadie puede editar.
create or replace function public.verify_results(
  p_event_id uuid,
  p_division_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cantidad int;
begin
  if not public.can_verify_event(p_event_id) then
    raise exception 'Solo el juez principal o la organización pueden verificar resultados'
      using errcode = 'insufficient_privilege';
  end if;

  update public.results
  set verified_by = auth.uid(),
      verified_at = now()
  where event_id = p_event_id
    and (p_division_id is null or division_id = p_division_id);

  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- Congela los resultados oficiales de una division (o de todo el evento).
--
-- El snapshot es una copia completa e inmutable. Desde que se publica, el
-- oficial deja de depender de `results`: si despues alguien recalcula el cache
-- o se corrige un marcaje, el podio anunciado sigue siendo el que se anuncio.
-- Cambiarlo exige publicar de nuevo, y esa republicacion queda registrada con
-- su propia fecha y su propio autor.
create or replace function public.publish_results(
  p_event_id uuid,
  p_division_id uuid default null
)
returns public.result_publications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_row public.result_publications;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Solo la organización puede publicar resultados'
      using errcode = 'insufficient_privilege';
  end if;

  with rankeado as (
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
      r.status,
      r.raw_ms,
      r.penalty_ms,
      r.total_ms,
      r.splits,
      rank() over (
        partition by r.division_id
        order by
          case r.status when 'finished' then 0 else 1 end,
          r.total_ms nulls last
      ) as rank_position
    from public.results r
    join public.teams t on t.id = r.team_id
    join public.divisions d on d.id = r.division_id
    where r.event_id = p_event_id
      and (p_division_id is null or r.division_id = p_division_id)
  )
  select jsonb_agg(to_jsonb(rankeado) order by division_name, rank_position)
  into v_snapshot
  from rankeado;

  insert into public.result_publications (event_id, division_id, published_by, snapshot)
  values (p_event_id, p_division_id, auth.uid(), coalesce(v_snapshot, '[]'::jsonb))
  returning * into v_row;

  return v_row;
end;
$$;

-- Resumen de lo que la organizacion tiene que mirar antes de publicar.
--
-- Junta en una sola consulta las tres cosas que hacen dudar de un resultado:
-- carriles que nunca sincronizaron, marcajes anulados y anomalias que detecto
-- el reductor (parciales imposiblemente cortos, marcajes sobrantes).
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
    coalesce(r.status, l.status),
    r.total_ms,
    (r.verified_at is not null),
    coalesce(r.source_event_count, 0),
    (select count(*)::int from public.timing_events te
     where te.lane_id = l.id and te.voided),
    coalesce(r.anomalies, '[]'::jsonb),
    (h.start_source = 'device_offline')
  from public.lanes l
  join public.heats h on h.id = l.heat_id
  left join public.teams t on t.id = l.team_id
  left join public.divisions d on d.id = t.division_id
  left join public.results r on r.lane_id = l.id
  where l.event_id = p_event_id
    and l.team_id is not null
    and public.can_verify_event(p_event_id)
  order by d.name, t.bib_number;
$$;

grant execute on function public.verify_results(uuid, uuid) to authenticated;
grant execute on function public.publish_results(uuid, uuid) to authenticated;
grant execute on function public.verification_queue(uuid) to authenticated;
