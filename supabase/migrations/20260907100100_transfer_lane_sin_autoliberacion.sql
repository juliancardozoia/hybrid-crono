-- El juez ya no puede soltar su propio carril.
--
-- `transfer_lane` tenia una autoliberacion (`p_to_judge is null` y quien
-- llama es el juez actual) para que alguien pudiera terminar un heat y
-- quedar libre sin esperar el lease de seis horas. Ahora ese "quedar libre"
-- pasa SOLO cuando el resultado del carril es terminal, y lo hace el
-- recalculo del servidor -- ver `actualizarCierreDeHeat` en recompute.ts --
-- sin que el juez toque nada. La autoliberacion manual ya no tiene un caso de
-- uso legitimo: dejarla significaba que un juez podia soltar un carril A
-- MEDIO JUZGAR, que es justo lo que la organizacion tiene que decidir, no el
-- juez.
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
begin
  select event_id, judge_id into v_event_id, v_previous
  from public.lanes where id = p_lane_id;

  if v_event_id is null then
    raise exception 'El carril no existe';
  end if;

  if not public.can_verify_event(v_event_id) then
    raise exception 'Solo el juez principal o la organización pueden transferir un carril'
      using errcode = 'insufficient_privilege';
  end if;

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
