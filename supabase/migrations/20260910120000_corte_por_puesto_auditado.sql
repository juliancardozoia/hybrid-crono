-- El corte deja de ser una lista de checkboxes libre, y queda auditado.
--
-- TRES problemas con la version anterior:
--
-- 1. SE PODIA PARTIR UN GRUPO EMPATADO. La seleccion era libre: nada impedia
--    marcar a uno de dos equipos empatados en el puesto 19 y dejar afuera al
--    otro, ni desmarcar el grupo entero de la frontera para achicar el field
--    a mano. Un empate deportivo no se puede resolver clickeando.
-- 2. NADA QUEDABA AUDITADO. Confirmado el corte, lo unico que sobrevivia era
--    la lista de quien avanzo (`stage_advancements`) y el tamano del field
--    nuevo. Explicar despues "por que este equipo quedo afuera" exigia
--    recalcular el standing historico desde `workout_scores` -- y una
--    correccion posterior de un score CAMBIA ese recalculo, asi que la
--    explicacion podia terminar siendo distinta de lo que en verdad paso el
--    dia del corte.
-- 3. CARRERA CONTRA EL LEADERBOARD. Nada impedia confirmar un corte sobre un
--    ranking que el organizador vio hace un minuto y que un score cargado
--    desde otra pestana ya cambio.
--
-- LA SOLUCION. El organizador elige un PUESTO de corte (no equipos sueltos):
-- `position <= puesto` avanza, y como los empatados COMPARTEN `position`, un
-- grupo en la frontera avanza o queda afuera ENTERO, sin caso especial.
-- `confirmarCorteDeEtapa` (servidor) recalcula el standing FRESCO con
-- `buildScoreboard`, compara su huella (`huellaDelStanding`,
-- src/shared/scoring/hash.ts) contra la que vio la pantalla, y solo si
-- coinciden arma el payload que manda a esta funcion. `cut_standings`
-- congela el standing COMPLETO -- clasificados Y eliminados -- para que
-- "por que quedo afuera" tenga una respuesta que no dependa de recalcular
-- nada despues.
--
-- El cambio de aridad (de 4 argumentos a 6, y \`p_points\` -> \`p_scoring_points\`
-- porque ahora tambien hay un \`points\` por atleta dentro de \`cut_standings\`)
-- exige DROP: \`create or replace\` no reemplaza una funcion si cambia la
-- cantidad de parametros, y sin el drop quedarian dos funciones con el mismo
-- nombre ("is not unique" en cualquier llamada).

alter table public.scoring_snapshots
  -- El puesto que eligio el organizador. Solo tiene sentido desde la etapa 2
  -- (un corte HACIA una etapa), por eso es nullable: la etapa 1 no se corta,
  -- la corre todo equipo activo.
  add column cut_position int,
  -- El standing COMPLETO al momento del corte: una entrada por equipo
  -- elegible, clasificado o no. Null en la etapa 1, que no es un corte.
  add column cut_standings jsonb,
  -- La huella que el organizador vio y confirmo. Ver huellaDelStanding.
  add column cut_standings_hash text;

drop function if exists public.confirmar_corte_de_etapa(uuid, int, uuid[], numeric[]);

create or replace function public.confirmar_corte_de_etapa(
  p_division_id uuid,
  p_stage int,
  p_cut_position int,
  p_cut_standings jsonb,
  p_cut_hash text,
  p_scoring_points numeric[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_bloqueado timestamptz;
  v_tie_policy public.tie_point_policy;
  v_avanzan uuid[];
begin
  select event_id into v_event_id from public.divisions where id = p_division_id;

  if v_event_id is null then
    raise exception 'La categoría no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para configurar la puntuación de esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  if p_stage < 2 then
    raise exception 'Un corte solo puede confirmarse hacia la etapa 2 o una posterior';
  end if;

  if p_cut_position is null or p_cut_position < 1 then
    raise exception 'Elegí un puesto de corte válido';
  end if;

  if p_cut_standings is null or jsonb_array_length(p_cut_standings) = 0 then
    raise exception 'El standing de esta etapa está vacío';
  end if;

  if p_cut_hash is null or length(trim(p_cut_hash)) = 0 then
    raise exception 'Falta la huella del standing que confirmaste';
  end if;

  -- Quien avanza SALE del payload, nunca se recalcula aca: la posicion no se
  -- puede calcular en SQL (el desempate por vector de puestos no es una
  -- window function -- ver 20260901100300_scoreboard.sql), y confiar en lo
  -- que ya valido `confirmarCorteDeEtapa` contra su propio recalculo fresco
  -- es lo que hace que la huella sirva de algo.
  select array_agg((elem->>'team_id')::uuid)
  into v_avanzan
  from jsonb_array_elements(p_cut_standings) elem
  where (elem->>'advanced')::boolean;

  if v_avanzan is null or array_length(v_avanzan, 1) is null then
    raise exception 'Ningún equipo queda clasificado con ese puesto de corte';
  end if;

  if p_scoring_points is null or array_length(p_scoring_points, 1) <> array_length(v_avanzan, 1) then
    raise exception 'La tabla de puntos no coincide con la cantidad de equipos clasificados';
  end if;

  select locked_at into v_bloqueado
  from public.scoring_snapshots
  where division_id = p_division_id and stage = p_stage;

  -- Un corte confirmado no se rehace solo: mismo criterio que
  -- guardar_snapshot_de_puntuacion, y por la misma razon -- recalcularlo
  -- cambiaria retroactivamente los puntos de las pruebas ya corridas en esa
  -- etapa.
  if v_bloqueado is not null then
    raise exception 'El corte de esta etapa ya está confirmado y no se puede rehacer';
  end if;

  if not public.etapa_previa_completa(p_division_id, p_stage) then
    raise exception 'La etapa anterior todavía no terminó: hay equipos sin resultado final en alguna de sus pruebas';
  end if;

  select tie_point_policy into v_tie_policy from public.events where id = v_event_id;

  delete from public.stage_advancements
  where division_id = p_division_id and stage = p_stage;

  insert into public.stage_advancements (event_id, division_id, stage, team_id, created_by)
  select v_event_id, p_division_id, p_stage, equipo, auth.uid()
  from unnest(v_avanzan) as equipo;

  insert into public.scoring_snapshots (
    event_id, division_id, stage, field_size, points, tie_point_policy,
    cut_position, cut_standings, cut_standings_hash, locked_at, created_by
  )
  values (
    v_event_id, p_division_id, p_stage, array_length(v_avanzan, 1), p_scoring_points, v_tie_policy,
    p_cut_position, p_cut_standings, p_cut_hash, now(), auth.uid()
  )
  on conflict (division_id, stage) do update set
    field_size = excluded.field_size,
    points = excluded.points,
    tie_point_policy = excluded.tie_point_policy,
    cut_position = excluded.cut_position,
    cut_standings = excluded.cut_standings,
    cut_standings_hash = excluded.cut_standings_hash,
    locked_at = excluded.locked_at,
    created_at = now(),
    created_by = excluded.created_by;
end;
$$;

select public.apply_function_lockdown();
