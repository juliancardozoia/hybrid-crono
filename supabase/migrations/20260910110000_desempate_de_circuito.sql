-- El circuito de una carrera hibrida nunca capturaba desempate:
-- `scoreFromLaneResult` (src/shared/scoring/fromTiming.ts) acepta
-- `tiebreakSegmentId`, pero el unico llamador de produccion
-- (recompute.ts) no se lo pasaba -- el parametro estaba vivo solo en tests.
-- `workout_scores.tiebreak_value` era siempre null para una parte de
-- circuito, asi que dos equipos con el mismo tiempo total quedaban
-- empatados sin ninguna forma de separarlos, aunque el circuito tuviera un
-- segmento intermedio (una estacion, un split) que hubiera desempatado.
--
-- `segments.es_tiebreak` es el espejo de `part_movements.es_tiebreak`, que ya
-- resuelve lo mismo para un WOD: el organizador marca UN segmento del
-- circuito como el hito de desempate, y el tiempo ACUMULADO al cerrar ese
-- segmento pasa a ser el `tiebreak_value` del equipo en esa parte.
--
-- POR QUE EN EL SEGMENTO Y NO EN LA PARTE. `part_divisions.course_template_id`
-- existe justamente porque "el circuito cuelga de (parte, division) y no de
-- la parte" (ver 20260901100000_pruebas_y_movimientos.sql): Elite y Open
-- pueden correr circuitos DISTINTOS dentro de la MISMA parte de circuito de un
-- evento. Marcar el desempate en la parte (`workout_parts.tiebreak_*`)
-- mezclaria dos circuitos independientes; marcarlo en el segmento, que SI
-- pertenece a una sola plantilla, no.

alter table public.segments
  add column es_tiebreak boolean not null default false;

-- Un solo segmento de desempate por PLANTILLA, en la base y no solo en el
-- RPC. El indice se comprueba POR STATEMENT: la funcion de abajo apaga el
-- anterior antes de prender el nuevo, porque un indice unico (a diferencia de
-- un constraint) no se puede diferir al commit. Cualquier `on conflict`
-- futuro contra este indice tiene que repetir el mismo `where es_tiebreak`, o
-- Postgres responde "no unique constraint matching the ON CONFLICT".
create unique index segments_un_solo_desempate
  on public.segments (course_template_id)
  where es_tiebreak;

create or replace function public.marcar_segmento_de_desempate(
  p_segment_id uuid,
  p_activo boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_template_id uuid;
  v_tiene boolean;
begin
  select event_id, course_template_id
  into v_event_id, v_template_id
  from public.segments
  where id = p_segment_id;

  if v_event_id is null then
    raise exception 'El segmento no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para configurar el circuito de esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  -- Apagar el anterior ANTES de prender este: con los dos prendidos a la vez
  -- (aunque sea entre dos updates de la misma transaccion), el indice unico
  -- parcial rechaza el segundo insert/update.
  update public.segments
  set es_tiebreak = false
  where course_template_id = v_template_id and es_tiebreak and id <> p_segment_id;

  update public.segments
  set es_tiebreak = p_activo
  where id = p_segment_id;

  v_tiene := exists (
    select 1 from public.segments
    where course_template_id = v_template_id and es_tiebreak
  );

  -- Sincroniza SOLO las partes que usan ESTA plantilla, resuelto via
  -- part_divisions -- nunca "si hay algun segmento marcado en el evento".
  -- Sin este acotamiento, marcar el desempate de un circuito T1 configuraria
  -- tambien la parte de un circuito T2 independiente que corre en el mismo
  -- evento (misma parte de circuito, otra categoria con otra plantilla), y
  -- desmarcar T2 podria apagar el de T1.
  --
  -- Se respeta un tiebreak_source distinto de null/'hito' (osea 'manual' u
  -- 'otra_prueba'): eso solo puede haberlo puesto una configuracion EXPLICITA
  -- desde "Editar parte" para esa parte, y este mecanismo no tiene por que
  -- pisarla. Sin este guard, alternar un checkbox de /circuito podria borrar
  -- silenciosamente un desempate que el organizador configuro a mano por otro
  -- camino.
  update public.workout_parts p
  set
    tiebreak_source = case when v_tiene then 'hito'::public.tiebreak_source else null end,
    tiebreak_unit = case when v_tiene then 'tiempo'::public.score_unit else null end,
    tiebreak_dir = case when v_tiene then 'menor_gana'::public.score_dir else null end,
    tiebreak_part_id = null
  where p.id in (
    select pd.part_id
    from public.part_divisions pd
    where pd.course_template_id = v_template_id
  )
  and (p.tiebreak_source is null or p.tiebreak_source = 'hito');
end;
$$;

select public.apply_function_lockdown();
