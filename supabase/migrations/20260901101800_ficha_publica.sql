-- La ficha publica muestra precio y cupo de cada categoria.
--
-- Es lo primero que un atleta quiere saber y lo unico que la ficha no decia:
-- listaba "Rx Masculino" y nada mas, asi que para averiguar cuanto sale y si
-- queda lugar habia que empezar el tramite de inscripcion. Media docena de
-- categorias, media docena de tramites a medias.
--
-- El cupo sale de `cupos_disponibles()`, que YA EXISTE y ya cuenta bien: suma
-- las confirmadas Y las que esperan pago. Reimplementar el conteo aqui seria
-- una segunda definicion de "cupo ocupado", y el dia que cambie una las dos
-- dirian cosas distintas — el mismo motivo por el que no hay scoring en SQL.

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
        -- Null = gratis; el precio se muestra o no segun eso, no segun un cero
        -- que podria ser un precio de verdad mal cargado.
        'priceCents', dr.price_cents,
        'currency', dr.currency,
        -- Null = sin limite. Es informacion util: "ilimitado" tranquiliza tanto
        -- como "quedan 3" apura.
        'capacity', dr.capacity,
        'cuposDisponibles', public.cupos_disponibles(d.id)
      ) order by d.name)
      from public.divisions d
      left join public.division_registration dr on dr.division_id = d.id
      where d.event_id = e.id
    ), '[]'::jsonb),
    -- Las pruebas se listan siempre; su CONTENIDO solo si el organizador ya lo
    -- libero. Un WOD cargado con semanas de anticipacion para configurar al
    -- juez no tiene por que ser publico desde ese momento.
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
            'timeCapMs', p.time_cap_ms,
            'windowMs', p.window_ms,
            'intervalMs', p.interval_ms
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
    'schedule', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', h.name,
        'scheduledAt', h.scheduled_at,
        'workout', w.name
      ) order by h.scheduled_at nulls last, h.name)
      from public.heats h
      left join public.workouts w on w.id = h.workout_id
      where h.event_id = e.id and h.scheduled_at is not null
    ), '[]'::jsonb)
  )
  from public.events e
  where e.public_slug = p_public_slug and e.published_at is not null;
$$;

select public.apply_function_lockdown();
