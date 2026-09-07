-- La tabla de puntos y el desempate pueden ser de la PRUEBA, no solo de la
-- categoria.
--
-- `part_divisions.scoring_table_id` existe desde el dia uno
-- (20260901100000_pruebas_y_movimientos) y no la leia nadie: el ranking
-- siempre usaba la tabla de la CATEGORIA (`divisions.scoring_table_id`), asi
-- que "el WOD final reparte el doble de puntos" no se podia configurar.
--
-- Y los cuatro `tiebreak_*` de `workout_parts` tenian solo la mitad resuelta:
-- `tiebreak_unit`/`tiebreak_dir` ya los consume `normalizeScore` cuando el
-- valor sale de la MISMA parte (`tiebreak_source` 'hito' o 'manual', via
-- `workout_scores.tiebreak_value`). Lo que faltaba era 'otra_prueba':
-- "el desempate de la final es el tiempo de la clasificatoria" necesita leer
-- el score de OTRA fila, y ni `scoreboard_document()` ni `standings.ts`
-- sabian que esa relacion existia.
--
-- Esta migracion solo agrega los datos que faltaban al documento del
-- scoreboard. El calculo sigue sin vivir en SQL -- eso es doctrina de todo el
-- proyecto -- se resuelve en `src/shared/scoring/`.

create or replace function public.scoreboard_document(
  p_event_id uuid,
  p_detalle boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'version', 3,
    'detalle', p_detalle,
    'event', (
      select jsonb_build_object(
        'name', e.name,
        'venue', e.venue,
        'status', e.status,
        'official', e.status = 'published'
      )
      from public.events e where e.id = p_event_id
    ),
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'scoringTable', coalesce(st.builtin_key, st.id::text, 'tiempo_total'),
        'customPoints', coalesce(st.points, '{}')
      ) order by d.name)
      from public.divisions d
      left join public.scoring_tables st on st.id = d.scoring_table_id
      where d.event_id = p_event_id
    ), '[]'::jsonb),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'workoutId', w.id,
        'workoutName', w.name,
        'label', p.label,
        'orderIndex', w.order_index * 1000 + p.order_index,
        'timeScheme', p.time_scheme,
        'scoreUnit', p.score_unit,
        'scoreDir', p.score_dir,
        'capUnit', p.cap_unit,
        'tiebreakUnit', p.tiebreak_unit,
        'tiebreakDir', p.tiebreak_dir,
        -- Solo si el desempate viene de OTRA parte. Null en el resto de los
        -- casos: ahi el valor ya esta en la fila de ESTA parte
        -- (`tiebreak_value`), que `scores` ya manda mas abajo.
        'tiebreakPartId', case when p.tiebreak_source = 'otra_prueba' then p.tiebreak_part_id end
      ) order by w.order_index, p.order_index)
      from public.workout_parts p
      join public.workouts w on w.id = p.workout_id
      where p.event_id = p_event_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'partId', pd.part_id,
        'divisionId', pd.division_id,
        -- La tabla de puntos de ESTA parte para ESTA categoria, si la hay. Se
        -- resuelve exactamente igual que la de `divisions` de arriba -- clave
        -- del catalogo, o el id de una tabla propia -- para que el cliente use
        -- la misma logica de resolucion (`resolverTabla`) en los dos casos. Sin
        -- override, los dos campos llegan null y el cliente cae a la tabla de
        -- la categoria.
        'scoringTable', case when pd.scoring_table_id is not null
                          then coalesce(st2.builtin_key, st2.id::text) end,
        'customPoints', case when pd.scoring_table_id is not null then st2.points end
      ))
      from public.part_divisions pd
      left join public.scoring_tables st2 on st2.id = pd.scoring_table_id
      where pd.event_id = p_event_id
    ), '[]'::jsonb),
    -- Los retirados NO entran al padron. Con posiciones fisicas, un equipo
    -- retirado que aparece al fondo le corre la posicion a todos los que estan
    -- detras y les cambia los puntos. Hay que decidirlo antes de competir, no
    -- despues de anunciar el podio.
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
        'tiebreak', ws.tiebreak_value
      ))
      from public.workout_scores ws
      join public.teams t on t.id = ws.team_id
      where ws.event_id = p_event_id and t.status <> 'withdrawn'
    ), '[]'::jsonb),
    -- Los parciales solo viajan cuando el evento los muestra. En el plan
    -- gratuito el atleta ve su tiempo final y nada mas.
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
$$;

select public.apply_function_lockdown();
