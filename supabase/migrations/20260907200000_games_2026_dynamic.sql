-- Un solo sistema de puntuacion, dinamico: Games 2026 Dynamic.
--
-- QUE SE VA. Las tablas fijas (`CF-Games 40`, `CF-Games 80`, `CF-Open`) y con
-- ellas la tabla `scoring_tables` entera y las dos columnas que la
-- referenciaban. Elegir "la tabla correcta" era una decision sin respuesta
-- buena: una de 40 puestos aplicada a 44 atletas dejaba a los puestos 41-44
-- empatados en CERO sin avisar, y una de 80 aplicada a 12 atletas hacia que
-- el ultimo saliera con 156 puntos, casi lo mismo que el ganador. Ademas
-- nadie las estaba usando: de 34 categorias en la base, UNA tenia tabla
-- asignada.
--
-- QUE VIENE. La curva de los CrossFit Games 2026 (30 puestos, de 100 a 0) se
-- proyecta sobre el tamano REAL de cada categoria, con interpolacion lineal.
-- El primero saca siempre el maximo y el ultimo siempre cero, tenga la
-- categoria 8 atletas o 200. La matematica vive en `src/shared/scoring/`
-- —ni una linea de scoring en SQL, misma doctrina que el resto del proyecto—
-- y lo que se guarda aca es el RESULTADO ya materializado.
--
-- POR QUE UN SNAPSHOT. La tabla no puede recalcularse sola: si se genera
-- contra "los atletas que hay ahora", el dia que uno se retira cambia el
-- tamano del field y con el los puntos que TODOS sacaron en las pruebas ya
-- corridas. El snapshot congela la curva al arrancar y la deja igual aunque
-- despues haya bajas.

-- ---------------------------------------------------------------------------
-- La tabla congelada de cada categoria
-- ---------------------------------------------------------------------------

create table public.scoring_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  division_id uuid not null,
  -- Etapas/cuts: "Stage 1 con 40 -> cut -> Stage 2 con 20". Hoy la app usa
  -- siempre la etapa 1; la columna existe para que el dia que se agreguen
  -- cortes no haya que migrar los snapshots ya congelados.
  stage int not null default 1 check (stage >= 1),
  field_size int not null check (field_size >= 1),
  -- El snapshot se guarda SIEMPRE normalizado a 100. El peso de cada prueba
  -- (`workout_parts.max_points`) se aplica al leerlo: guardar un snapshot por
  -- prueba multiplicaria las filas sin agregar informacion, porque la forma de
  -- la curva es la misma y solo cambia la escala.
  points numeric(9, 3)[] not null check (array_length(points, 1) >= 1),
  -- Congelado. Mientras sea null se puede regenerar; despues no.
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade,
  unique (division_id, stage)
);

create index scoring_snapshots_event_idx on public.scoring_snapshots (event_id, stage);

alter table public.scoring_snapshots enable row level security;

-- Lo puede leer cualquiera que pueda leer el evento: es parte de como se
-- explica un resultado, no un dato sensible.
create policy scoring_snapshots_read on public.scoring_snapshots
  for select using (public.puede_leer_evento(event_id));

-- Sin GRANT de insert/update/delete a proposito, igual que `timing_events` y
-- `workout_scores`: se escribe SOLO por las funciones de abajo, que validan
-- permiso y respetan el bloqueo.
revoke all on public.scoring_snapshots from anon, authenticated;
grant select on public.scoring_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- El peso de cada prueba
-- ---------------------------------------------------------------------------

-- No todos los WODs valen lo mismo: una final puede repartir el doble. Antes
-- esto se hacia asignandole otra TABLA a la parte (`part_divisions
-- .scoring_table_id`), que obligaba a crear una tabla entera para expresar
-- "esta vale el doble". Un multiplicador dice lo mismo y no se puede
-- desincronizar de la curva.
alter table public.workout_parts
  add column max_points numeric(9, 3) not null default 100
    check (max_points > 0 and max_points <= 10000);

-- ---------------------------------------------------------------------------
-- Guardar y bloquear el snapshot
-- ---------------------------------------------------------------------------

-- Recibe los puntos YA CALCULADOS. La curva no se calcula en SQL a proposito:
-- vive en `src/shared/scoring/points.ts` y la usan el servidor y el navegador,
-- asi que una segunda implementacion aca podria divergir del podio que ve el
-- atleta. Mismo criterio que `guardar_specs_de_parte`.
create or replace function public.guardar_snapshot_de_puntuacion(
  p_division_id uuid,
  p_field_size int,
  p_points numeric[],
  p_stage int default 1,
  p_lock boolean default false
)
returns public.scoring_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_bloqueado timestamptz;
  v_fila public.scoring_snapshots;
begin
  select event_id into v_event_id from public.divisions where id = p_division_id;

  if v_event_id is null then
    raise exception 'La categoría no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para configurar la puntuación de esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  if p_points is null or array_length(p_points, 1) is null then
    raise exception 'La tabla de puntos no puede estar vacía';
  end if;

  select locked_at into v_bloqueado
  from public.scoring_snapshots
  where division_id = p_division_id and stage = p_stage;

  -- Una tabla bloqueada no se toca. Regenerarla cambiaria retroactivamente
  -- los puntos de las pruebas ya corridas.
  if v_bloqueado is not null then
    raise exception 'La tabla de puntuación de esta categoría ya está bloqueada: los puntos de las pruebas ya corridas no se pueden recalcular';
  end if;

  insert into public.scoring_snapshots as s (
    event_id, division_id, stage, field_size, points, locked_at, created_by
  )
  values (
    v_event_id, p_division_id, p_stage, p_field_size, p_points,
    case when p_lock then now() end, auth.uid()
  )
  on conflict (division_id, stage) do update set
    field_size = excluded.field_size,
    points = excluded.points,
    locked_at = excluded.locked_at,
    created_at = now(),
    created_by = excluded.created_by
  returning * into v_fila;

  return v_fila;
end;
$$;

create or replace function public.bloquear_snapshot_de_puntuacion(
  p_division_id uuid,
  p_stage int default 1
)
returns public.scoring_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_fila public.scoring_snapshots;
begin
  select event_id into v_event_id from public.divisions where id = p_division_id;

  if v_event_id is null then
    raise exception 'La categoría no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para configurar la puntuación de esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  update public.scoring_snapshots
  set locked_at = coalesce(locked_at, now())
  where division_id = p_division_id and stage = p_stage
  returning * into v_fila;

  if v_fila.id is null then
    raise exception 'Esta categoría todavía no tiene tabla de puntuación generada';
  end if;

  return v_fila;
end;
$$;

-- ---------------------------------------------------------------------------
-- El documento del leaderboard deja de hablar de tablas
-- ---------------------------------------------------------------------------

-- Cambia el bloque `divisions` (ya no lleva `scoringTable`/`customPoints`,
-- lleva el snapshot y el tamano del field) y el bloque `parts` (gana
-- `maxPoints`). `assignments` deja de llevar la tabla por parte: eso ahora es
-- el peso de la prueba, que viaja en `parts`.
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
    'version', 4,
    'detalle', p_detalle,
    'event', (
      select jsonb_build_object(
        'name', e.name,
        'venue', e.venue,
        'status', e.status,
        'format', e.format,
        'official', e.status = 'published'
      )
      from public.events e where e.id = p_event_id
    ),
    'divisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'name', d.name,
        -- La curva congelada de esta categoria, normalizada a 100. Null
        -- mientras no se haya generado: ahi el cliente la calcula al vuelo con
        -- los atletas que hay, que es lo correcto ANTES de competir.
        'snapshot', (
          select sn.points
          from public.scoring_snapshots sn
          where sn.division_id = d.id and sn.stage = 1
        ),
        'snapshotLocked', (
          select sn.locked_at is not null
          from public.scoring_snapshots sn
          where sn.division_id = d.id and sn.stage = 1
        )
      ) order by d.name)
      from public.divisions d
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
        'maxPoints', p.max_points,
        'tiebreakUnit', p.tiebreak_unit,
        'tiebreakDir', p.tiebreak_dir,
        'tiebreakPartId', case when p.tiebreak_source = 'otra_prueba' then p.tiebreak_part_id end
      ) order by w.order_index, p.order_index)
      from public.workout_parts p
      join public.workouts w on w.id = p.workout_id
      where p.event_id = p_event_id
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'partId', pd.part_id,
        'divisionId', pd.division_id
      ))
      from public.part_divisions pd
      where pd.event_id = p_event_id
    ), '[]'::jsonb),
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

-- ---------------------------------------------------------------------------
-- Fuera las tablas fijas
-- ---------------------------------------------------------------------------

-- El orden importa: `scoreboard_document` es `language sql` y Postgres SI
-- registra la dependencia con las tablas que menciona, asi que hay que
-- redefinirla (arriba) ANTES de soltar `scoring_tables`.
alter table public.divisions drop column if exists scoring_table_id;
alter table public.part_divisions drop column if exists scoring_table_id;
drop table if exists public.scoring_tables;

-- Los puntos ahora llevan tres decimales, no dos: con dos, dos puestos
-- consecutivos de un field grande caen en el mismo valor y empatan a dos
-- atletas que no empataron en nada.
alter table public.standings
  alter column total_points type numeric(12, 3);

select public.apply_function_lockdown();
