-- Engancha el modelo de pruebas con lo que ya existia, sin romper nada.
--
-- QUE PASA CON LOS EVENTOS QUE YA ESTABAN
--
-- Hasta ahora el evento ERA un circuito: divisions.course_template_id era NOT
-- NULL y la cadena lane -> team -> division -> course_template definia que se
-- cronometraba. El backfill de abajo traduce eso 1:1 — cada evento pasa a tener
-- una prueba "Circuito" con una sola parte, y cada categoria conserva
-- EXACTAMENTE el circuito que ya corria. Ningun tiempo cambia.
--
-- QUE PASA CON EL CODIGO QUE YA ESTABA
--
-- createHeat, createDivision y los fixtures de los tests no saben que existen
-- las pruebas, y no tienen por que aprenderlo para seguir funcionando. Por eso
-- heats.workout_id y lanes.workout_id los completan triggers en vez de exigirse
-- en el insert: un evento con una sola prueba no deberia obligar a elegirla.

alter table public.divisions
  add column scoring_table_id uuid references public.scoring_tables (id) on delete set null;

-- Una categoria de CrossFit no tiene UN circuito: tiene N pruebas. La columna
-- se conserva porque el bundle del juez y el recalculo todavia la leen; queda
-- como respaldo hasta que los dos pasen a resolver por part_divisions.
alter table public.divisions alter column course_template_id drop not null;

alter table public.heats add column workout_id uuid;

-- El carril se ata a la PRUEBA y no a la parte: una prueba de dos partes
-- (por ejemplo un AMRAP y despues una carga maxima) la juzga la misma persona
-- en el mismo carril de corrido, y produce un score por cada parte.
alter table public.lanes add column workout_id uuid;

-- El plan de la organizacion. Todavia no gatea nada: la publicacion y las
-- funciones en vivo se apoyan en el en una fase posterior.
create type public.org_plan as enum ('free', 'pro');
alter table public.organizations add column plan public.org_plan not null default 'free';

-- Los snapshots viejos guardan filas ya rankeadas; los nuevos guardan scores
-- crudos y el ranking se deriva al leer. Sin la version, un lector nuevo leeria
-- un snapshot viejo esperando otra forma y mostraria una tabla vacia.
alter table public.result_publications add column snapshot_version int not null default 1;

-- ---------------------------------------------------------------------------
-- La prueba por defecto de un evento
-- ---------------------------------------------------------------------------

-- Devuelve la parte de circuito del evento, creandola si hace falta.
--
-- NO es SECURITY DEFINER a proposito: corre con los privilegios de quien la
-- llama, asi que RLS decide. Un usuario que no puede administrar el evento no
-- puede crear su prueba, sin necesidad de un guard escrito a mano que se pueda
-- olvidar.
create or replace function public.ensure_circuit_part(p_event_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_part_id uuid;
  v_workout_id uuid;
begin
  select p.id into v_part_id
  from public.workout_parts p
  where p.event_id = p_event_id and p.time_scheme = 'circuito'
  order by p.order_index
  limit 1;

  if v_part_id is not null then
    return v_part_id;
  end if;

  insert into public.workouts (event_id, order_index, name)
  values (
    p_event_id,
    coalesce((select max(order_index) + 1 from public.workouts where event_id = p_event_id), 0),
    'Circuito'
  )
  returning id into v_workout_id;

  insert into public.workout_parts (
    workout_id, event_id, order_index, label,
    time_scheme, capture_mode, score_unit, score_dir
  )
  values (v_workout_id, p_event_id, 0, '', 'circuito', 'en_vivo', 'tiempo', 'menor_gana')
  returning id into v_part_id;

  return v_part_id;
end;
$$;

-- Una categoria nueva con circuito queda inscripta sola en la prueba de
-- circuito del evento. Es lo que hace que la pantalla de divisiones siga
-- funcionando sin cambios.
create or replace function public.division_entra_al_circuito()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_part_id uuid;
begin
  if new.course_template_id is null then
    return new;
  end if;

  v_part_id := public.ensure_circuit_part(new.event_id);

  insert into public.part_divisions (part_id, division_id, event_id, course_template_id)
  values (v_part_id, new.id, new.event_id, new.course_template_id)
  on conflict (part_id, division_id)
    do update set course_template_id = excluded.course_template_id;

  return new;
end;
$$;

create trigger divisions_entra_al_circuito
  after insert or update of course_template_id on public.divisions
  for each row execute function public.division_entra_al_circuito();

-- Un heat sin prueba explicita toma la primera del evento.
create or replace function public.heat_toma_prueba_por_defecto()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.workout_id is not null then
    return new;
  end if;

  select w.id into new.workout_id
  from public.workouts w
  where w.event_id = new.event_id
  order by w.order_index
  limit 1;

  if new.workout_id is null then
    -- El evento todavia no tiene ninguna prueba: se le crea la del circuito,
    -- que es lo que hacia implicitamente antes de que las pruebas existieran.
    perform public.ensure_circuit_part(new.event_id);
    select w.id into new.workout_id
    from public.workouts w
    where w.event_id = new.event_id
    order by w.order_index
    limit 1;
  end if;

  return new;
end;
$$;

create trigger heats_prueba_por_defecto
  before insert on public.heats
  for each row execute function public.heat_toma_prueba_por_defecto();

-- Cambiar la prueba de un heat que ya tiene carriles dejaria los carriles
-- apuntando a otra cosa y, peor, marcajes colgando de una prueba que el atleta
-- no corrio.
--
-- OJO CON EL `old.workout_id is not null`: sin el, este mismo guard hace fallar
-- el BACKFILL de mas abajo. Un heat que ya existia tiene la columna en null, y
-- rellenarla por primera vez es distinct from null, asi que el trigger lo lee
-- como "te estan cambiando la prueba" y aborta la migracion entera.
--
-- Ademas de romper la migracion, la condicion estaba mal planteada: asignar la
-- prueba por primera vez NO es cambiarla. Los heats nuevos nunca llegan aca con
-- null porque el trigger de insert se la pone, asi que la excepcion no le abre
-- la puerta a nada.
--
-- Los tests de PGlite no lo atraparon y no podian: alli las migraciones corren
-- sobre una base VACIA, el backfill actualiza cero filas y ningun trigger llega
-- a dispararse. Es la unica parte del esquema cuyo trabajo es tocar datos que ya
-- existen, y por eso es la unica que no se puede dar por probada hasta correrla
-- contra una base con datos.
create or replace function public.heat_prueba_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.workout_id is not null
     and new.workout_id is distinct from old.workout_id
     and exists (select 1 from public.lanes where heat_id = old.id) then
    raise exception 'El heat ya tiene carriles: no se puede cambiar la prueba';
  end if;
  return new;
end;
$$;

create trigger heats_prueba_inmutable
  before update on public.heats
  for each row execute function public.heat_prueba_inmutable();

-- El carril hereda la prueba de su heat.
--
-- Se resuelve con un trigger y NO con una FK compuesta (heat_id, workout_id)
-- hacia heats. Esa FK seria una SEGUNDA relacion lanes -> heats, y PostgREST
-- devolveria PGRST201 en el embed `heats (...)` que usan getJudgeLanes y
-- fetchLaneBundle. Como el codigo hace `data ?? []`, la pantalla del juez
-- volveria a decir "no hay carriles" sin mostrar ningun error — el mismo
-- incidente que ya paso una vez — y los tests de PGlite no lo atraparian.
create or replace function public.lane_toma_prueba_del_heat()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select h.workout_id into new.workout_id
  from public.heats h
  where h.id = new.heat_id;

  if new.workout_id is null then
    raise exception 'El heat % no tiene prueba asignada', new.heat_id;
  end if;

  return new;
end;
$$;

create trigger lanes_prueba_del_heat
  before insert or update of heat_id on public.lanes
  for each row execute function public.lane_toma_prueba_del_heat();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- Una prueba "Circuito" por evento que tenga alguna categoria con circuito.
insert into public.workouts (event_id, order_index, name)
select distinct d.event_id, 0, 'Circuito'
from public.divisions d
where d.course_template_id is not null
  and not exists (select 1 from public.workouts w where w.event_id = d.event_id);

insert into public.workout_parts (
  workout_id, event_id, order_index, label, time_scheme, capture_mode, score_unit, score_dir
)
select w.id, w.event_id, 0, '', 'circuito', 'en_vivo', 'tiempo', 'menor_gana'
from public.workouts w
where w.order_index = 0
  and not exists (select 1 from public.workout_parts p where p.workout_id = w.id);

-- Cada categoria conserva EXACTAMENTE el circuito que ya corria.
insert into public.part_divisions (part_id, division_id, event_id, course_template_id)
select p.id, d.id, d.event_id, d.course_template_id
from public.divisions d
join public.workouts w on w.event_id = d.event_id and w.order_index = 0
join public.workout_parts p on p.workout_id = w.id and p.order_index = 0
where d.course_template_id is not null
on conflict (part_id, division_id) do nothing;

update public.heats h
set workout_id = w.id
from public.workouts w
where w.event_id = h.event_id and w.order_index = 0 and h.workout_id is null;

update public.lanes l
set workout_id = h.workout_id
from public.heats h
where h.id = l.heat_id and l.workout_id is null;

-- Los eventos que quedaron sin prueba (sin ninguna categoria con circuito) no
-- pueden tener heats, asi que a esta altura no queda ningun heat sin prueba.
alter table public.heats alter column workout_id set not null;
alter table public.lanes alter column workout_id set not null;

alter table public.heats
  add constraint heats_workout_fk
  foreign key (workout_id, event_id)
  references public.workouts (id, event_id) on delete restrict;

alter table public.lanes
  add constraint lanes_workout_fk
  foreign key (workout_id, event_id)
  references public.workouts (id, event_id) on delete restrict;

create index heats_workout_idx on public.heats (workout_id);
create index lanes_workout_idx on public.lanes (workout_id);

-- ---------------------------------------------------------------------------
-- Un equipo corre una vez por PRUEBA, no una vez por evento
-- ---------------------------------------------------------------------------
--
-- El indice viejo impedia que un equipo tuviera dos carriles en todo el evento,
-- que era la regla correcta cuando el evento era una sola carrera. Con N
-- pruebas, el mismo equipo corre la prueba 1, la 2 y la 3. Con una sola prueba
-- —Hyrox— la garantia es literalmente la misma de antes: un tiempo por dorsal.

drop index public.lanes_team_once_per_event;

create unique index lanes_team_once_per_workout
  on public.lanes (workout_id, team_id)
  where team_id is not null;

-- ---------------------------------------------------------------------------
-- Los resultados ya reducidos pasan a ser scores
-- ---------------------------------------------------------------------------
--
-- Es una COPIA de un valor que el reductor ya calculo, no un recalculo en SQL.
-- El scoring no vive en Postgres y esta migracion no lo cambia.

insert into public.workout_scores (
  part_id, team_id, event_id, division_id, score_unit, status,
  value_num, source, lane_id, verified_by, verified_at
)
select
  p.id,
  r.team_id,
  r.event_id,
  r.division_id,
  'tiempo',
  case r.status
    when 'finished' then 'valido'::public.score_status
    when 'running' then 'en_curso'
    when 'dnf' then 'dnf'
    when 'dq' then 'dq'
    else 'pendiente'
  end,
  r.total_ms,
  'en_vivo',
  r.lane_id,
  r.verified_by,
  r.verified_at
from public.results r
join public.lanes l on l.id = r.lane_id
join public.workout_parts p on p.workout_id = l.workout_id and p.order_index = 0
where r.team_id is not null
  and r.division_id is not null
on conflict (part_id, team_id) do nothing;

-- Una prueba de dos partes produce un score por parte desde el mismo carril,
-- asi que la unicidad es por (carril, parte) y no solo por carril.
drop index public.workout_scores_lane_idx;
create unique index workout_scores_lane_idx
  on public.workout_scores (lane_id, part_id) where lane_id is not null;

-- ---------------------------------------------------------------------------
-- Validaciones de configuracion
-- ---------------------------------------------------------------------------
--
-- POR QUE HAY QUE REESCRIBIRLA ACA Y NO DESPUES
--
-- El primer bloque comparaba `s.course_template_id = d.course_template_id`. Con
-- course_template_id ahora nullable, esa igualdad da NULL para una categoria
-- sin circuito, el NOT EXISTS nunca da true, y la validacion DEJA DE REPORTAR
-- divisiones sin segmentos. No tira ningun error: simplemente deja de proteger.

create or replace function public.event_config_issues(p_event_id uuid)
returns table (severity text, code text, detail text)
language sql
stable
set search_path = public, pg_temp
as $$
  -- Categorias que corren un circuito sin segmentos cargados.
  select
    'error'::text,
    'division_sin_segmentos'::text,
    format('La division "%s" usa un circuito sin segmentos.', d.name)
  from public.part_divisions pd
  join public.divisions d on d.id = pd.division_id
  join public.workout_parts p on p.id = pd.part_id
  where pd.event_id = p_event_id
    and p.time_scheme = 'circuito'
    and (
      pd.course_template_id is null
      or not exists (
        select 1 from public.segments s
        where s.course_template_id = pd.course_template_id
      )
    )

  union all

  -- Categorias que no corren ninguna prueba: nadie les puede cargar resultado.
  select
    'error'::text,
    'division_sin_pruebas'::text,
    format('La division "%s" no esta asignada a ninguna prueba.', d.name)
  from public.divisions d
  where d.event_id = p_event_id
    and not exists (
      select 1 from public.part_divisions pd where pd.division_id = d.id
    )

  union all

  -- Pruebas que no las corre nadie.
  select
    'warning'::text,
    'prueba_sin_divisiones'::text,
    format('La prueba "%s" no tiene ninguna categoria asignada.', w.name)
  from public.workout_parts p
  join public.workouts w on w.id = p.workout_id
  where p.event_id = p_event_id
    and not exists (
      select 1 from public.part_divisions pd where pd.part_id = p.id
    )

  union all

  -- Pruebas de CrossFit sin ningun movimiento cargado: el juez no tendria que
  -- marcar y la carga manual no sabria que pedir.
  select
    'error'::text,
    'prueba_sin_movimientos'::text,
    format('La prueba "%s" no tiene movimientos cargados.', w.name)
  from public.workout_parts p
  join public.workouts w on w.id = p.workout_id
  where p.event_id = p_event_id
    and p.time_scheme <> 'circuito'
    and not exists (
      select 1 from public.part_movements pm where pm.part_id = p.id
    )

  union all

  -- Equipos con mas o menos integrantes de los que pide su division.
  select
    'error'::text,
    'equipo_incompleto'::text,
    format(
      'El dorsal %s tiene %s integrante(s) y su division "%s" exige %s.',
      t.bib_number, coalesce(m.cantidad, 0), d.name, d.team_size
    )
  from public.teams t
  join public.divisions d on d.id = t.division_id
  left join (
    select team_id, count(*)::int as cantidad
    from public.team_members
    group by team_id
  ) m on m.team_id = t.id
  where t.event_id = p_event_id
    and t.status <> 'withdrawn'
    and coalesce(m.cantidad, 0) <> d.team_size

  union all

  -- Parejas mixtas que no tienen un integrante de cada sexo.
  select
    'error'::text,
    'mixta_invalida'::text,
    format('El dorsal %s esta en una division mixta pero no tiene un integrante de cada sexo.', t.bib_number)
  from public.teams t
  join public.divisions d on d.id = t.division_id
  where t.event_id = p_event_id
    and d.gender_rule = 'mixed'
    and t.status <> 'withdrawn'
    and (
      (select count(*) from public.team_members tm
       join public.athletes a on a.id = tm.athlete_id
       where tm.team_id = t.id and a.gender = 'male') < 1
      or
      (select count(*) from public.team_members tm
       join public.athletes a on a.id = tm.athlete_id
       where tm.team_id = t.id and a.gender = 'female') < 1
    )

  union all

  -- Divisiones de un solo sexo con alguien que no corresponde.
  select
    'error'::text,
    'sexo_no_corresponde'::text,
    format('El dorsal %s tiene integrantes que no corresponden a la division "%s".', t.bib_number, d.name)
  from public.teams t
  join public.divisions d on d.id = t.division_id
  where t.event_id = p_event_id
    and d.gender_rule in ('male', 'female')
    and t.status <> 'withdrawn'
    and exists (
      select 1 from public.team_members tm
      join public.athletes a on a.id = tm.athlete_id
      where tm.team_id = t.id
        and a.gender is distinct from d.gender_rule::text::public.athlete_gender
    )

  union all

  -- Divisiones sin nadie inscripto: no es un error, pero conviene avisarlo
  -- antes de armar heats.
  select
    'warning'::text,
    'division_vacia'::text,
    format('La division "%s" no tiene equipos inscriptos.', d.name)
  from public.divisions d
  where d.event_id = p_event_id
    and not exists (select 1 from public.teams t where t.division_id = d.id)

  union all

  -- Atletas sin fecha de nacimiento en divisiones con rango de edad.
  select
    'warning'::text,
    'edad_desconocida'::text,
    format('%s %s compite en "%s", que tiene rango de edad, pero no tiene fecha de nacimiento.',
           a.first_name, a.last_name, d.name)
  from public.team_members tm
  join public.athletes a on a.id = tm.athlete_id
  join public.teams t on t.id = tm.team_id
  join public.divisions d on d.id = t.division_id
  where tm.event_id = p_event_id
    and a.birth_date is null
    and (d.age_min is not null or d.age_max is not null);
$$;

select public.apply_function_lockdown();
