-- Los scores de cada equipo en cada parte, y el cache del leaderboard general.
--
-- workout_scores es al scoring lo que results es al timing: un cache de valores
-- crudos. El ranking, los puntos y los desempates NO existen en Postgres — se
-- derivan al leer, en src/shared/scoring/, exactamente como el tiempo se deriva
-- en src/shared/timing/. Si hubiera una segunda implementacion en SQL, el
-- leaderboard en vivo y el oficial podrian diferir, que es justo lo que el
-- producto no puede permitirse.
--
-- La diferencia con timing_events: un score manual SI se edita. Por eso hay
-- auditoria — sin rastro de quien cambio las 142 reps por 152, un leaderboard
-- reclamado no se puede defender.

create type public.score_status as enum (
  'pendiente',  -- todavia no se cargo ni se cronometro
  'en_curso',
  'valido',
  'capeado',    -- no termino dentro del cap; rankea por la unidad del cap
  'dnf',
  'dq'
);

create table public.workout_scores (
  part_id uuid not null,
  team_id uuid not null,
  event_id uuid not null,
  division_id uuid not null,
  -- Copiada de la parte. Solo existe para que el CHECK de abajo sea local a la
  -- fila: validar contra la unidad de la parte exigiria un join, y un CHECK no
  -- puede hacer joins. La mantiene sincronizada un trigger, NO una FK compuesta
  -- (part_id, score_unit): esa seria una SEGUNDA relacion workout_scores ->
  -- workout_parts, y PostgREST responde PGRST201 "more than one relationship
  -- found" en cualquier embed de workout_parts. El codigo hace `data ?? []`, o
  -- sea que la pantalla quedaria vacia sin mostrar ningun error, y los tests de
  -- PGlite no lo atraparian porque PGlite no tiene PostgREST.
  score_unit public.score_unit not null,
  status public.score_status not null default 'pendiente',

  -- Valor principal, en `score_unit`. Milisegundos si es tiempo, kilos si es
  -- carga, reps si es reps.
  value_num numeric(14, 3),
  -- Reps de la ronda parcial. Solo cuando score_unit es 'rondas_reps'.
  value_reps int check (value_reps >= 0),
  -- Valor en la unidad del cap. Solo cuando el status es 'capeado'.
  value_cap numeric(14, 3),
  tiebreak_value numeric(14, 3),

  -- De donde salio. 'en_vivo' lo escribe UNICAMENTE el recalculo, a partir del
  -- reductor; 'manual' lo escribe upsert_workout_score().
  source public.capture_mode not null default 'manual',
  lane_id uuid,

  entered_by uuid references auth.users (id) on delete set null,
  entered_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),

  primary key (part_id, team_id),

  -- Un score derivado SIEMPRE viene de un carril; uno manual NUNCA.
  constraint score_source_lane check ((source = 'en_vivo') = (lane_id is not null)),

  -- La columna que corresponde al estado esta cargada. Un score 'valido' con
  -- value_num en null se colaria como cero y saldria primero en una prueba por
  -- tiempo: el bug mas caro posible en esta tabla.
  constraint score_valor_segun_estado check (
    status not in ('valido', 'capeado')
    or (status = 'capeado' and value_cap is not null)
    or (
      status = 'valido'
      and value_num is not null
      and (score_unit <> 'rondas_reps' or value_reps is not null)
    )
  ),

  foreign key (part_id, event_id)
    references public.workout_parts (id, event_id) on delete cascade,
  foreign key (team_id, event_id)
    references public.teams (id, event_id) on delete cascade,
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade,
  -- CASCADE y no SET NULL: una FK compuesta con SET NULL anula TODAS sus
  -- columnas, y event_id es NOT NULL. Ademas es lo mismo que hace `results`,
  -- por la misma razon: un score derivado es cache del log, y si el carril
  -- desaparece lo reconstruye el recalculo. Los scores manuales tienen lane_id
  -- nulo, asi que reasignar carriles no los toca.
  foreign key (lane_id, event_id)
    references public.lanes (id, event_id) on delete cascade
);

create index workout_scores_tablero_idx
  on public.workout_scores (event_id, division_id, part_id);
create unique index workout_scores_lane_idx
  on public.workout_scores (lane_id) where lane_id is not null;

create trigger workout_scores_touch_updated_at
  before update on public.workout_scores
  for each row execute function public.touch_updated_at();

-- Deriva del servidor lo que el cliente no tiene por que decidir: en que unidad
-- se mide la prueba, a que evento pertenece y en que categoria compite el
-- equipo. Es la misma leccion que `recorded_by = auth.uid()` en
-- ingest_timing_events: si viene en el payload, se puede falsear.
create or replace function public.completar_datos_de_score()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capture_mode public.capture_mode;
begin
  select p.score_unit, p.event_id, p.capture_mode
  into new.score_unit, new.event_id, v_capture_mode
  from public.workout_parts p
  where p.id = new.part_id;

  if new.event_id is null then
    raise exception 'La prueba % no existe', new.part_id;
  end if;

  -- El origen del score y el modo de captura de la prueba tienen que coincidir.
  --
  -- Sin esto, un recalculo que tomara una prueba de carga manual la reduciria a
  -- "pendiente" y borraria el score que el staff ya habia cargado. La direccion
  -- opuesta ya la cubre upsert_workout_score(), que rechaza las pruebas en
  -- vivo. Las dos juntas hacen que cada prueba tenga UN solo camino de
  -- escritura, garantizado por la base y no por acordarse de filtrar.
  if new.source <> v_capture_mode then
    raise exception 'Esta prueba se captura en modo %, no en %', v_capture_mode, new.source;
  end if;

  select t.division_id into new.division_id
  from public.teams t
  where t.id = new.team_id and t.event_id = new.event_id;

  if new.division_id is null then
    raise exception 'El equipo % no pertenece a este evento', new.team_id;
  end if;

  return new;
end;
$$;

create trigger workout_scores_completar
  before insert or update on public.workout_scores
  for each row execute function public.completar_datos_de_score();

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------

create table public.workout_score_audit (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null,
  team_id uuid not null,
  event_id uuid not null references public.events (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  antes jsonb,
  despues jsonb not null,
  motivo text,
  created_at timestamptz not null default now()
);

create index workout_score_audit_score_idx
  on public.workout_score_audit (part_id, team_id, created_at desc);
create index workout_score_audit_event_idx
  on public.workout_score_audit (event_id, created_at desc);

-- La auditoria la escribe el trigger y no la app, para que no dependa de que
-- todos los caminos de escritura se acuerden de registrarla.
create or replace function public.registrar_cambio_de_score()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workout_score_audit (part_id, team_id, event_id, actor_id, antes, despues)
  values (
    new.part_id,
    new.team_id,
    new.event_id,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger workout_scores_audit
  after insert or update on public.workout_scores
  for each row execute function public.registrar_cambio_de_score();

-- ---------------------------------------------------------------------------
-- Cache del leaderboard general
-- ---------------------------------------------------------------------------
--
-- Mismo estatuto que `results`: se puede borrar entera y reconstruirse. La
-- posicion se guarda aca —a diferencia de results, que la deriva al leer— por
-- una razon concreta: con N pruebas y desempate por vector de puestos, un
-- rank() de SQL no puede reproducirla. La escribe el recalculo del servidor
-- corriendo computeOverall(), la misma funcion pura que usa el navegador.

create table public.standings (
  event_id uuid not null references public.events (id) on delete cascade,
  division_id uuid not null,
  team_id uuid not null,
  position int not null check (position > 0),
  tied_with int not null default 1 check (tied_with > 0),
  total_points numeric(10, 2) not null default 0,
  per_part jsonb not null default '[]'::jsonb,
  tiebreak_vector int[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (division_id, team_id),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade,
  foreign key (team_id, event_id)
    references public.teams (id, event_id) on delete cascade
);

create index standings_event_idx on public.standings (event_id, division_id, position);

-- ---------------------------------------------------------------------------
-- Carga manual de un score
-- ---------------------------------------------------------------------------

create or replace function public.upsert_workout_score(
  p_part_id uuid,
  p_team_id uuid,
  p_score jsonb
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

  -- coalesce obligatorio: can_verify_event puede devolver NULL, y en plpgsql
  -- `if not NULL then` NO entra al bloque. Un guard escrito sin esto deja pasar
  -- justo a quien no es miembro.
  if not coalesce(public.can_verify_event(v_event_id), false) then
    raise exception 'No tienes permiso para cargar resultados en este evento';
  end if;

  -- Una prueba que se juzga en vivo la escribe SOLO el recalculo, a partir del
  -- reductor. Si la carga manual pudiera pisarla, el tiempo mostrado en la
  -- pantalla del juez y el oficial podrian diferir.
  if v_parte.capture_mode = 'en_vivo' then
    raise exception 'Esta prueba se captura en vivo: su resultado no se carga a mano';
  end if;

  -- La division sale del equipo, no del payload: un cliente no decide en que
  -- categoria compite nadie.
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

-- Sella los scores como revisados. Hermana de verify_results(), que hace lo
-- mismo con los resultados de circuito.
--
-- Igual que aquella, NO toca ningun valor: solo deja constancia de quien miro
-- que, y cuando. Un score que despues se corrige vuelve a quedar sin verificar,
-- porque upsert_workout_score() limpia el sello.
create or replace function public.verify_workout_scores(
  p_event_id uuid,
  p_part_id uuid default null,
  p_division_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cantidad int;
begin
  if not coalesce(public.can_verify_event(p_event_id), false) then
    raise exception 'Solo el juez principal o la organización pueden verificar resultados'
      using errcode = 'insufficient_privilege';
  end if;

  update public.workout_scores
  set verified_by = auth.uid(),
      verified_at = now()
  where event_id = p_event_id
    and (p_part_id is null or part_id = p_part_id)
    and (p_division_id is null or division_id = p_division_id)
    and status <> 'pendiente';

  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.workout_scores enable row level security;
alter table public.workout_score_audit enable row level security;
alter table public.standings enable row level security;

-- Lectura para cualquier miembro del evento. La ESCRITURA no tiene politica a
-- proposito: no hay GRANT de insert/update, asi que todo pasa por
-- upsert_workout_score() o por el service role del recalculo. Es la misma
-- jugada que hace inmutable a timing_events — la garantia es un privilegio
-- ausente, no una politica presente.
create policy workout_scores_read on public.workout_scores
  for select using (public.event_role(event_id) is not null);

create policy workout_score_audit_read on public.workout_score_audit
  for select using (public.can_verify_event(event_id));

create policy standings_read on public.standings
  for select using (public.event_role(event_id) is not null);

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------

revoke all on public.workout_scores from anon, authenticated;
revoke all on public.workout_score_audit from anon, authenticated;
revoke all on public.standings from anon, authenticated;

grant select on public.workout_scores to authenticated;
grant select on public.workout_score_audit to authenticated;
grant select on public.standings to authenticated;

select public.apply_function_lockdown();
