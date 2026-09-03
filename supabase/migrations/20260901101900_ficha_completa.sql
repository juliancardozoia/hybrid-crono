-- La ficha publica, completa: cronograma ubicable y pruebas explicadas.
--
-- Antes el cronograma era "Heat 1 — 09:30" y las pruebas "Evento 2 · AMRAP de
-- 12 min". Ninguna de las dos le sirve al atleta el dia del evento:
--
--   El cronograma no decia EN QUE ARENA ni QUE CATEGORIA, que es exactamente lo
--   que se necesita para saber a donde ir y a que hora. Con tres escenarios en
--   paralelo, una lista de horas sin lugar es inutil.
--
--   Las pruebas no decian los MOVIMIENTOS ni los PESOS. Un atleta se prepara
--   semanas mirando eso, y hasta ahora tenia que esperar a que el organizador
--   lo publicara por Instagram.
--
-- Lo que NO cambia: el contenido de una prueba sigue saliendo solo si
-- `released_at` ya paso. El organizador carga los WODs con anticipacion para
-- configurar la pantalla del juez, y cuando se revelan lo decide el.

create or replace function public.public_event_detail(p_public_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'slug', e.public_slug,
    'name', e.name,
    'description', e.description,
    'logoUrl', e.logo_url,
    'coverUrl', e.cover_url,
    'format', e.format,
    'eventType', e.event_type,
    'status', e.status,
    'country', e.country,
    'state', e.state,
    'city', e.city,
    'venue', e.venue,
    'address', e.address,
    'startsAt', e.starts_at,
    'endsAt', e.ends_at,
    'registrationOpensAt', e.registration_opens_at,
    'registrationClosesAt', e.registration_closes_at,
    'timezone', e.timezone,
    'organizerName', e.organizer_name,
    'instagram', e.instagram,
    'website', e.website,
    'shirtSizes', e.shirt_sizes,
    'inscripcionesAbiertas', (
      (e.registration_opens_at is null or e.registration_opens_at <= now())
      and (e.registration_closes_at is null or e.registration_closes_at > now())
    ),
    'resultadosVisibles', e.status in ('live', 'verifying', 'published'),
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', d.name,
        'teamSize', d.team_size,
        'genderRule', d.gender_rule,
        'ageMin', d.age_min,
        'ageMax', d.age_max,
        'level', d.level,
        'priceCents', dr.price_cents,
        'currency', dr.currency,
        'capacity', dr.capacity,
        'cuposDisponibles', public.cupos_disponibles(d.id)
      ) order by d.name)
      from public.divisions d
      left join public.division_registration dr on dr.division_id = d.id
      where d.event_id = e.id
    ), '[]'::jsonb),

    -- Las pruebas se listan siempre; su CONTENIDO solo si el organizador ya lo
    -- libero.
    'workouts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', w.name,
        'liberado', (w.released_at is not null and w.released_at <= now()),
        'description', case when w.released_at is not null and w.released_at <= now()
                            then w.description else null end,
        'parts', case when w.released_at is not null and w.released_at <= now() then (
          select coalesce(jsonb_agg(jsonb_build_object(
            'label', p.label,
            'timeScheme', p.time_scheme,
            'scoreUnit', p.score_unit,
            'scoreDir', p.score_dir,
            'teamMode', p.team_mode,
            'timeCapMs', p.time_cap_ms,
            'windowMs', p.window_ms,
            'intervalMs', p.interval_ms,
            -- Que categorias la corren. Sin esto, un atleta de Amateur no sabe
            -- si el WOD que esta leyendo es el suyo.
            'divisiones', coalesce((
              select jsonb_agg(d2.name order by d2.name)
              from public.part_divisions pd
              join public.divisions d2 on d2.id = pd.division_id
              where pd.part_id = p.id
            ), '[]'::jsonb),
            'blocks', coalesce((
              select jsonb_agg(jsonb_build_object(
                'kind', b.kind,
                'label', b.label,
                'rondas', b.repeticiones,
                'duracionMs', b.duracion_ms,
                'descansoMs', b.descanso_ms,
                'movimientos', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    -- Del catalogo, o el nombre escrito a mano cuando falta.
                    'nombre', coalesce(mov.name, pm.custom_name),
                    'unidad', pm.unit,
                    'objetivo', pm.target_per_round,
                    'cargaKg', pm.load_kg,
                    'maxReps', pm.max_reps,
                    'notas', pm.notes,
                    -- El peso de CADA categoria. Es el dato por el que se
                    -- entra a esta pantalla: Rx y Scaled levantan distinto.
                    'porCategoria', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'division', d3.name,
                        'objetivo', s.target_per_round,
                        'cargaKg', s.load_kg,
                        'notas', s.notes
                      ) order by d3.name)
                      from public.division_movement_specs s
                      join public.divisions d3 on d3.id = s.division_id
                      where s.part_movement_id = pm.id
                    ), '[]'::jsonb)
                  ) order by pm.order_index)
                  from public.part_movements pm
                  left join public.movements mov on mov.id = pm.movement_id
                  where pm.block_id = b.id
                ), '[]'::jsonb)
              ) order by b.order_index)
              from public.part_blocks b where b.part_id = p.id
            ), '[]'::jsonb)
          ) order by p.order_index), '[]'::jsonb)
          from public.workout_parts p where p.workout_id = w.id
        ) else '[]'::jsonb end
      ) order by w.order_index)
      from public.workouts w where w.event_id = e.id
    ), '[]'::jsonb),

    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('name', doc.name, 'url', doc.url) order by doc.order_index)
      from public.event_documents doc where doc.event_id = e.id
    ), '[]'::jsonb),

    -- Los escenarios, para que el cronograma se pueda agrupar por lugar.
    'arenas', coalesce((
      select jsonb_agg(a.name order by a.order_index)
      from public.arenas a where a.event_id = e.id
    ), '[]'::jsonb),

    -- El cronograma: hora, lugar, prueba y categoria. Sin dorsales ni jueces.
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', h.name,
        'scheduledAt', h.scheduled_at,
        'scheduledEndAt', h.scheduled_end_at,
        'arena', a.name,
        'division', d.name,
        'workout', w.name,
        'lanes', h.lane_count
      ) order by h.scheduled_at nulls last, a.order_index nulls last, h.name)
      from public.heats h
      left join public.workouts w on w.id = h.workout_id
      left join public.arenas a on a.id = h.arena_id
      left join public.divisions d on d.id = h.division_id
      where h.event_id = e.id and h.scheduled_at is not null
    ), '[]'::jsonb)
  )
  from public.events e
  where e.public_slug = p_public_slug and e.published_at is not null;
$$;

select public.apply_function_lockdown();
