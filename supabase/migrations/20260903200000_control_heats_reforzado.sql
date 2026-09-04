-- Refuerzos al control de heats, pedidos tras probar el flujo de Hyrox:
--
-- 1. Un juez pre-asignado a dos heats que terminan solapando (uno arranca
--    antes de que el otro termine) podia largar los dos. `transfer_lane` no
--    lo impedia -- solo `claim_lane` (la AUTOasignacion del juez) tenia el
--    limite de un heat a la vez. `start_heat` ahora lo revisa tambien: no
--    deja largar un heat si alguno de sus jueces ya esta en otro heat que
--    arranco y todavia no termino.
--
-- 2. Para saber "todavia no termino" hace falta saber cuando termina un
--    heat, y nada lo registraba: `heats.status` nunca llega a 'finished' en
--    ningun lado del codigo. `ended_at` es la columna que faltaba, y la
--    llena `recomputeLanes()` -- el mismo recalculo que ya corre cada vez
--    que un juez sincroniza -- cuando los resultados de TODOS los carriles
--    con atleta de un heat llegan a un estado terminal (finished/dnf/dq).
--    Si un recalculo posterior (p. ej. anular un marcaje) hace que deje de
--    estar completo, se destranca sola.

alter table public.heats
  add column ended_at timestamptz;

create or replace function public.start_heat(p_heat_id uuid)
returns public.heats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_heat public.heats;
  v_estado public.event_status;
  v_sin_juez int;
  v_con_atleta int;
  v_jueces_ocupados text;
begin
  select * into v_heat from public.heats where id = p_heat_id;

  if v_heat.id is null then
    raise exception 'El heat no existe';
  end if;

  if not public.can_verify_event(v_heat.event_id) then
    raise exception 'No tienes permiso para iniciar este heat'
      using errcode = 'insufficient_privilege';
  end if;

  -- Idempotente: un doble tap en el boton de largada nunca puede reiniciar el
  -- reloj de seis atletas en carrera.
  if v_heat.started_at is not null then
    return v_heat;
  end if;

  select status into v_estado from public.events where id = v_heat.event_id;

  if v_estado = 'draft' then
    raise exception 'La competencia está en borrador. Márcala como lista y ponla en vivo antes de iniciar.';
  end if;

  if v_estado in ('verifying', 'published') then
    raise exception 'La competencia ya terminó: no se pueden iniciar heats nuevos.';
  end if;

  select
    count(*) filter (where team_id is not null),
    count(*) filter (where team_id is not null and judge_id is null)
  into v_con_atleta, v_sin_juez
  from public.lanes
  where heat_id = p_heat_id;

  if v_con_atleta = 0 then
    raise exception 'El heat no tiene ningún atleta asignado a sus carriles.';
  end if;

  if v_sin_juez > 0 then
    raise exception 'Faltan jueces: % de % carriles con atleta no tienen juez asignado.',
      v_sin_juez, v_con_atleta;
  end if;

  -- Ningun juez de este heat puede estar YA en otro heat en curso. Es
  -- fisicamente imposible cronometrar dos a la vez, y esto es lo que impide
  -- que se largue: `transfer_lane` deja pre-asignar al mismo juez a heats
  -- que en el papel no se pisan pero terminan largandose juntos.
  select string_agg(
    distinct coalesce(p.full_name, p.email, 'un juez'), ', '
    order by coalesce(p.full_name, p.email, 'un juez')
  )
  into v_jueces_ocupados
  from public.lanes l
  join public.lanes l2 on l2.judge_id = l.judge_id and l2.heat_id <> l.heat_id
  join public.heats h2 on h2.id = l2.heat_id
  left join public.profiles p on p.id = l.judge_id
  where l.heat_id = p_heat_id
    and l.judge_id is not null
    and h2.started_at is not null
    and h2.ended_at is null;

  if v_jueces_ocupados is not null then
    raise exception 'Ya están en otro heat en curso: %. Tienen que liberar ese carril antes de largar este.',
      v_jueces_ocupados;
  end if;

  -- Largar el primer heat es lo que pone la competencia en vivo.
  if v_estado = 'ready' then
    update public.events set status = 'live' where id = v_heat.event_id;
  end if;

  update public.heats
  set started_at = now(),
      started_by = auth.uid(),
      start_source = 'server',
      status = 'running'
  where id = p_heat_id
  returning * into v_heat;

  update public.lanes
  set status = 'running'
  where heat_id = p_heat_id and status = 'idle' and team_id is not null;

  return v_heat;
end;
$$;

select public.apply_function_lockdown();
