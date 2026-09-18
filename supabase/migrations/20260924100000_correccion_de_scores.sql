-- Fase 1 de la correccion de resultados de CrossFit: la organizacion puede
-- ajustar un score ya cargado -venga del juez en vivo o de carga manual- por
-- una impugnacion o reclamo, sin tener que tocar `capture_mode` de la prueba
-- entera (que reabriria la prueba a cualquier equipo, no solo al que tiene
-- el reclamo).
--
-- El razonamiento que ordena esto: el juez termina su trabajo cuando cierra
-- el carril/heat. De ahi en mas, cualquier cambio sobre ese resultado es una
-- decision de la organizacion, nunca un recalculo automatico que reconstruya
-- el dato desde cero. Por eso la correccion queda MARCADA (corregido_en,
-- corregido_por) y el recalculo automatico (recalcularWod, en
-- src/features/verification/lib/recompute.ts) tiene que saltear cualquier
-- fila marcada -- ver ese archivo para la mitad del guard que vive en TS.

alter table public.workout_scores
  add column corregido_en timestamptz,
  add column corregido_por uuid references auth.users (id) on delete set null;

comment on column public.workout_scores.corregido_en is
  'Cuando la organizacion corrigio este score por una impugnacion. No nulo '
  'protege la fila: el recalculo automatico del cronometro/WOD no la vuelve '
  'a escribir a partir de aca.';

-- corregir_workout_score() es DISTINTA de upsert_workout_score() a proposito
-- (no una sola funcion con un modo): esta corrige un score que YA EXISTE,
-- sin importar su origen (en_vivo o manual), preservando `source`/`lane_id`
-- -- nunca crea una fila 'manual' sobre una prueba en_vivo, asi que no hace
-- falta relajar el trigger `completar_datos_de_score` ni el constraint
-- `score_source_lane`. Restringida a `can_verify_event()` (mas estricta que
-- `can_score_event()`, que si alcanza para la carga inicial) porque resolver
-- una impugnacion es una decision de cabeza de jueces u organizacion, no de
-- cualquiera que puede tipear un resultado.
create or replace function public.corregir_workout_score(
  p_part_id uuid,
  p_team_id uuid,
  p_score jsonb,
  p_motivo text
)
returns public.workout_scores
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parte public.workout_parts;
  v_status public.score_status;
  v_fila public.workout_scores;
begin
  select * into v_parte from public.workout_parts where id = p_part_id;
  if not found then
    raise exception 'La prueba no existe';
  end if;

  -- coalesce obligatorio: en plpgsql `if not NULL then` NO entra al bloque,
  -- asi que un guard escrito sin esto deja pasar justo a quien no es miembro.
  if not coalesce(public.can_verify_event(v_parte.event_id), false) then
    raise exception 'Solo el juez principal o la organización pueden corregir un resultado'
      using errcode = 'insufficient_privilege';
  end if;

  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'Escribe el motivo de la corrección';
  end if;

  v_status := coalesce((p_score ->> 'status')::public.score_status, 'valido');

  -- Mismo mecanismo que upsert_workout_score(): deja el motivo en una
  -- variable de sesion para que el trigger de auditoria lo lea sin tener que
  -- conocer los parametros de la funcion que disparo el UPDATE.
  perform set_config('scora.motivo_correccion', p_motivo, true);

  update public.workout_scores as ws set
    status = v_status,
    value_num = (p_score ->> 'value')::numeric,
    value_reps = (p_score ->> 'reps')::int,
    value_cap = (p_score ->> 'capValue')::numeric,
    tiebreak_value = (p_score ->> 'tiebreak')::numeric,
    corregido_en = now(),
    corregido_por = auth.uid()
    -- source y lane_id NUNCA se tocan: preservan de donde vino el score
    -- originalmente, aunque de aca en mas lo haya ajustado la organizacion.
  where ws.part_id = p_part_id and ws.team_id = p_team_id
  returning * into v_fila;

  -- 0 filas quiere decir que no hay nada que corregir todavia -- esta
  -- funcion es para AJUSTAR un valor existente, no para cargarlo por primera
  -- vez (eso es upsert_workout_score()).
  if not found then
    raise exception 'No hay un resultado cargado para corregir: cargalo primero';
  end if;

  return v_fila;
end;
$$;

select public.apply_function_lockdown();
