-- Una categoria puede correr una VARIANTE del movimiento, no solo otro peso.
--
-- QUE FALTABA
--
-- `division_movement_specs` ya hacia Rx contra Scaled para el peso y las
-- repeticiones, pero el MOVIMIENTO en si era siempre el de la fila: un AMRAP
-- con "25 single unders / double unders / double crossovers" segun la
-- categoria obligaba a crear tres WODs identicos que solo difieren en un
-- salto -- exactamente el problema que la grilla de pesos ya resuelve para el
-- peso.
--
-- Igual que el peso, es OPCIONAL y por CATEGORIA: vacio = el mismo movimiento
-- que ya tiene la fila. Mismo criterio "uno de los dos, o ninguno" que
-- `part_movements` (catalogo o texto libre), pero acA los dos pueden ser NULL
-- porque NULL significa heredar, no "sin nombre".

alter table public.division_movement_specs
  add column movement_id uuid references public.movements (id) on delete restrict,
  add column custom_name text check (custom_name is null or length(trim(custom_name)) > 0),
  add constraint variante_no_ambigua
    check (not (movement_id is not null and custom_name is not null));

-- ---------------------------------------------------------------------------
-- Guardar la grilla: ahora tambien viaja la variante de movimiento
-- ---------------------------------------------------------------------------
--
-- Mismo contrato que antes -- reemplaza TODO lo de la parte, no hace merge --
-- con dos campos nuevos en cada fila del payload:
--   { ..., "movementId": uuid | null, "customName": text | null }
--
-- Una fila que SOLO trae variante de movimiento (sin objetivo ni carga propia)
-- ahora tambien cuenta como ajuste real: antes de esto, "cambiar nada mas que
-- el movimiento" no tenia ningun campo que la salvara del filtro de "celda
-- vacia".
create or replace function public.guardar_specs_de_parte(
  p_part_id uuid,
  p_specs jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  select event_id into v_event_id from public.workout_parts where id = p_part_id;

  if v_event_id is null then
    raise exception 'La prueba no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para editar esta prueba'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.division_movement_specs s
  where s.part_movement_id in (
    select pm.id from public.part_movements pm where pm.part_id = p_part_id
  );

  insert into public.division_movement_specs
    (division_id, part_movement_id, event_id, target_per_round, load_kg, load_unit,
     movement_id, custom_name)
  select
    (fila ->> 'divisionId')::uuid,
    (fila ->> 'partMovementId')::uuid,
    v_event_id,
    case
      when fila -> 'objetivo' is null or jsonb_typeof(fila -> 'objetivo') <> 'array'
        then null
      else (
        select array_agg(valor::int order by orden)
        from jsonb_array_elements_text(fila -> 'objetivo')
             with ordinality as t(valor, orden)
      )
    end,
    nullif(fila ->> 'cargaKg', '')::numeric,
    coalesce((fila ->> 'cargaUnidad')::public.load_unit, 'kg'),
    nullif(fila ->> 'movementId', '')::uuid,
    nullif(fila ->> 'customName', '')
  from jsonb_array_elements(coalesce(p_specs, '[]'::jsonb)) as fila
  -- Una fila sin objetivo, NI carga, NI variante de movimiento no es un
  -- ajuste: es una celda vacia. Los parentesis NO son decorativos: `and` liga
  -- mas fuerte que `or`, y sin ellos la validacion del movimiento se
  -- aplicaria a la mitad de la condicion.
  where (
      nullif(fila ->> 'cargaKg', '') is not null
      or jsonb_typeof(fila -> 'objetivo') = 'array'
      or nullif(fila ->> 'movementId', '') is not null
      or nullif(fila ->> 'customName', '') is not null
    )
    -- El movimiento tiene que ser de ESTA parte: el `part_id` no viene en el
    -- payload a proposito, se valida contra la base.
    and (fila ->> 'partMovementId')::uuid in (
      select pm.id from public.part_movements pm where pm.part_id = p_part_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ficha publica: la variante tambien se anuncia
-- ---------------------------------------------------------------------------
--
-- Mismo criterio que el peso: el atleta necesita saber ANTES de anotarse (o
-- de entrenar para la fecha) que su categoria salta distinto que la de al
-- lado. `nombre` sale null cuando la categoria no cambia el movimiento -- la
-- pantalla ya sabe leer eso como "el de la fila".
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
        'cuposDisponibles', public.cupos_disponibles(d.id),
        -- El estandar declarado: que se levanta en esta categoria y cuanto.
        -- Es opcional al crear la categoria, asi que lo normal es que venga
        -- vacio y la pantalla no pinte nada.
        'movimientos', coalesce((
          select jsonb_agg(jsonb_build_object(
            -- Del catalogo, o el nombre escrito a mano cuando falta.
            'nombre', coalesce(mov.name, dm.custom_name),
            'cargaKg', dm.load_kg,
            'cargaUnidad', dm.load_unit,
            'spec', dm.spec,
            'notas', dm.notes
          ) order by dm.order_index)
          from public.division_movements dm
          left join public.movements mov on mov.id = dm.movement_id
          where dm.division_id = d.id
        ), '[]'::jsonb)
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
            -- El tope de tiempo de cada categoria, cuando difiere. Solo salen
            -- las que tienen uno propio: si ninguna lo cambia, la lista viene
            -- vacia y la pantalla no pinta nada.
            'capPorCategoria', coalesce((
              select jsonb_agg(jsonb_build_object(
                'division', d4.name,
                'timeCapMs', pd2.time_cap_ms
              ) order by d4.name)
              from public.part_divisions pd2
              join public.divisions d4 on d4.id = pd2.division_id
              where pd2.part_id = p.id and pd2.time_cap_ms is not null
            ), '[]'::jsonb),
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
                    'cargaUnidad', pm.load_unit,
                    'maxReps', pm.max_reps,
                    'notas', pm.notes,
                    -- El peso Y LA VARIANTE de CADA categoria. Es el dato por
                    -- el que se entra a esta pantalla: Rx y Scaled levantan
                    -- distinto, y ahora tambien pueden saltar distinto.
                    'porCategoria', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'division', d3.name,
                        'objetivo', s.target_per_round,
                        'cargaKg', s.load_kg,
                        'cargaUnidad', s.load_unit,
                        -- null = la categoria hace el MISMO movimiento de la
                        -- fila. La pantalla no pinta nada en ese caso.
                        'nombre', coalesce(mov_s.name, s.custom_name),
                        'notas', s.notes
                      ) order by d3.name)
                      from public.division_movement_specs s
                      join public.divisions d3 on d3.id = s.division_id
                      left join public.movements mov_s on mov_s.id = s.movement_id
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

-- Todo `create function` nace con EXECUTE otorgado a PUBLIC, en cada
-- `create or replace` -- no solo la primera vez. Sin este llamado, las dos
-- funciones de arriba quedarian invocables por cualquiera con la anon key.
select public.apply_function_lockdown();
