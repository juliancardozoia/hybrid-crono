-- Fase 0 de la correccion de resultados de CrossFit (ver el plan de
-- "correccion y carga manual de resultados de CrossFit"): deja lista la
-- infraestructura de auditoria con motivo. corregir_workout_score() (fase 1,
-- todavia no existe) la va a usar para dejar registrado por que la
-- organizacion ajusto un resultado ante una impugnacion; upsert_workout_score
-- ya puede aprovecharla si algun llamador decide pasar un motivo tambien al
-- corregir un valor cargado a mano.
--
-- El trigger que escribe workout_score_audit (registrar_cambio_de_score) no
-- tiene forma de conocer el motivo: es un trigger generico sin acceso a los
-- parametros de la funcion que disparo el UPDATE. Se resuelve con el patron
-- estandar de Postgres: la funcion que SI sabe el motivo lo deja en una
-- variable de sesion antes de escribir, y el trigger la lee. set_config con
-- is_local=true la hace valida solo para la transaccion actual -- no se
-- filtra a ninguna otra escritura de la misma sesion. Queda null en
-- cualquier escritura que no pase por una funcion que la setee (el
-- recalculo automatico del servicio, por ejemplo), que es exactamente donde
-- no aplica.

create or replace function public.registrar_cambio_de_score()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workout_score_audit (part_id, team_id, event_id, actor_id, antes, despues, motivo)
  values (
    new.part_id,
    new.team_id,
    new.event_id,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new),
    nullif(current_setting('scora.motivo_correccion', true), '')
  );
  return new;
end;
$$;

-- create or replace function no reemplaza una funcion si cambia la aridad:
-- agregar p_motivo (aunque tenga default) dejaria DOS funciones con el mismo
-- nombre hasta hacer un drop explicito de la firma vieja -- la misma trampa
-- que ya mordio a admin_create_registration y a confirmar_corte_de_etapa.
drop function if exists public.upsert_workout_score(uuid, uuid, jsonb);

create or replace function public.upsert_workout_score(
  p_part_id uuid,
  p_team_id uuid,
  p_score jsonb,
  p_motivo text default null
)
returns public.workout_scores
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parte public.workout_parts;
  v_event_id uuid;
  v_division_id uuid;
  v_status public.score_status;
  v_fila public.workout_scores;
begin
  select * into v_parte from public.workout_parts where id = p_part_id;
  if not found then
    raise exception 'La prueba no existe';
  end if;

  v_event_id := v_parte.event_id;

  -- coalesce obligatorio: en plpgsql `if not NULL then` NO entra al bloque,
  -- asi que un guard escrito sin esto deja pasar justo a quien no es miembro.
  if not coalesce(public.can_score_event(v_event_id), false) then
    raise exception 'No tienes permiso para cargar resultados en este evento';
  end if;

  if v_parte.capture_mode = 'en_vivo' then
    raise exception 'Esta prueba se captura en vivo: su resultado no se carga a mano';
  end if;

  select division_id into v_division_id
  from public.teams
  where id = p_team_id and event_id = v_event_id;

  if v_division_id is null then
    raise exception 'El equipo no pertenece a este evento';
  end if;

  if not exists (
    select 1 from public.part_divisions
    where part_id = p_part_id and division_id = v_division_id
  ) then
    raise exception 'La categoria de este equipo no corre esta prueba';
  end if;

  v_status := coalesce((p_score ->> 'status')::public.score_status, 'valido');

  perform set_config('scora.motivo_correccion', coalesce(p_motivo, ''), true);

  insert into public.workout_scores as ws (
    part_id, team_id, event_id, division_id, score_unit, status,
    value_num, value_reps, value_cap, tiebreak_value,
    source, lane_id, entered_by, entered_at
  )
  values (
    p_part_id, p_team_id, v_event_id, v_division_id, v_parte.score_unit, v_status,
    (p_score ->> 'value')::numeric,
    (p_score ->> 'reps')::int,
    (p_score ->> 'capValue')::numeric,
    (p_score ->> 'tiebreak')::numeric,
    'manual', null, auth.uid(), now()
  )
  on conflict (part_id, team_id) do update set
    status = excluded.status,
    value_num = excluded.value_num,
    value_reps = excluded.value_reps,
    value_cap = excluded.value_cap,
    tiebreak_value = excluded.tiebreak_value,
    entered_by = excluded.entered_by,
    entered_at = excluded.entered_at,
    -- Un score que se corrige vuelve a quedar sin verificar: si alguien lo
    -- toco despues de la verificacion, hay que mirarlo de nuevo.
    verified_by = null,
    verified_at = null
  where ws.source = 'manual'
  returning * into v_fila;

  -- 0 filas devueltas quiere decir que el WHERE del DO UPDATE no se cumplio:
  -- la fila que ya estaba la produjo el cronometro.
  if not found then
    raise exception 'Este resultado lo produjo el cronometro: no se puede editar a mano';
  end if;

  return v_fila;
end;
$$;

select public.apply_function_lockdown();
