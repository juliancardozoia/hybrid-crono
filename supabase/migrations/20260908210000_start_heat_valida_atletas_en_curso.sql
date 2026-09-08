-- `start_heat` ya impedia largar un heat si alguno de sus JUECES estaba en
-- otro heat en curso, pero no revisaba lo mismo para los EQUIPOS: nada
-- impedia largar el heat de la prueba 2 con un atleta que todavia esta
-- corriendo (o sin terminar) el heat de la prueba 1. `lanes_team_once_per_workout`
-- solo evita repetir la MISMA prueba, no protege el orden entre pruebas
-- distintas.
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
  v_equipos_en_curso text;
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

  -- Mismo chequeo, pero para el ATLETA: no puede largar la prueba 2 mientras
  -- sigue corriendo (heat iniciado y sin terminar) la prueba 1, sea la misma
  -- prueba u otra distinta. Sin esto, un heat mal armado dejaba a un equipo
  -- con dos relojes corriendo a la vez.
  select string_agg(
    distinct coalesce(t.name, '#' || t.bib_number::text), ', '
    order by coalesce(t.name, '#' || t.bib_number::text)
  )
  into v_equipos_en_curso
  from public.lanes l
  join public.lanes l2 on l2.team_id = l.team_id and l2.heat_id <> l.heat_id
  join public.heats h2 on h2.id = l2.heat_id
  join public.teams t on t.id = l.team_id
  where l.heat_id = p_heat_id
    and l.team_id is not null
    and h2.started_at is not null
    and h2.ended_at is null;

  if v_equipos_en_curso is not null then
    raise exception 'Todavía están corriendo otro heat sin terminar: %. Esperá a que termine antes de largar este.',
      v_equipos_en_curso;
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
