-- Un heat corre SU prueba, no siempre la primera del evento.
--
-- EL BUG QUE CIERRA
--
-- `heats.workout_id` es NOT NULL y lo rellenaba `heat_toma_prueba_por_defecto()`
-- con "la primera prueba del evento" (`order by order_index limit 1`). Ni
-- `createHeat`, ni `assign_heat_lanes`, ni `auto_distribuir_heats` pasaban nunca
-- la prueba -- el cast `HeatInsertConTrigger` de lib/supabase/types.ts existe
-- justamente porque nadie la escribia.
--
-- Con UNA sola prueba eso es correcto y es el caso de toda carrera hibrida. Con
-- VARIAS -- que es el caso normal de un CrossFit -- todos los heats de la
-- competencia quedaban atados al WOD 1: los jueces abrian el WOD 1 en su
-- celular, y los `workout_scores` de las tres pruebas se escribian contra el
-- `part_id` del WOD 1. No daba ningun error, y como `heat_prueba_inmutable`
-- bloquea el cambio en cuanto el heat tiene carriles, era IRREVERSIBLE sin
-- borrar el heat.

-- ---------------------------------------------------------------------------
-- 1. El nombre del heat es unico por PRUEBA, ademas de por categoria
-- ---------------------------------------------------------------------------
--
-- Sin esto, apenas un heat corriera el WOD 2 el "Heat 1" de Individual
-- Masculino chocaria con el "Heat 1" de esa misma categoria en el WOD 1, y
-- `createHeat` devolveria "Ya hay un heat con ese nombre en esta categoria" --
-- un mensaje que no describe el problema. Es el mismo movimiento que ya se hizo
-- una vez, cuando dos CATEGORIAS no podian tener cada una su "Heat 1"
-- (20260904100000_distribucion_automatica).
--
-- NO NECESITA BACKFILL, y esa es la razon de que vaya primera: hoy todos los
-- heats de un evento comparten `workout_id`, asi que el indice nuevo es
-- estrictamente MAS PERMISIVO que el que reemplaza y ninguna fila existente
-- puede violarlo.
alter table public.heats
  drop constraint heats_event_id_division_id_name_key,
  add constraint heats_event_workout_division_name_key
    unique (event_id, workout_id, division_id, name);

-- ---------------------------------------------------------------------------
-- 2. El default solo vale cuando no hay decision que tomar
-- ---------------------------------------------------------------------------
--
-- Se CONSERVA como fallback, no se borra: una carrera hibrida tiene exactamente
-- una prueba -- la crea `ensure_circuit_part()` -- y no tiene por que elegirla.
-- Eso mantiene andando sin tocar una linea a `createHeat`, a los fixtures de
-- supabase/tests/ y a scripts/seed-dev.mjs.
--
-- Lo que cambia es el caso de VARIAS pruebas: ahi falla ruidoso en vez de elegir
-- la primera en silencio. Un default tiene que ser predecible; "la primera" no
-- tiene ninguna relacion con lo que el organizador quiso, y el error que produce
-- no se puede deshacer.
--
-- Se descarto el default "la unica prueba que esta categoria todavia no corrio":
-- depende de en que orden se armen los heats, asi que dos organizadores haciendo
-- lo mismo en distinto orden obtendrian resultados distintos.
create or replace function public.heat_toma_prueba_por_defecto()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cuantas int;
begin
  if new.workout_id is not null then
    return new;
  end if;

  select count(*) into v_cuantas
  from public.workouts w
  where w.event_id = new.event_id;

  if v_cuantas = 0 then
    -- El evento todavia no tiene ninguna prueba: se le crea la del circuito,
    -- que es lo que hacia implicitamente antes de que las pruebas existieran.
    perform public.ensure_circuit_part(new.event_id);
  elsif v_cuantas > 1 then
    raise exception 'Esta competencia tiene varias pruebas: elige cuál corre este heat';
  end if;

  select w.id into new.workout_id
  from public.workouts w
  where w.event_id = new.event_id
  order by w.order_index
  limit 1;

  if new.workout_id is null then
    raise exception 'La competencia no tiene ninguna prueba';
  end if;

  return new;
end;
$$;

-- `heat_prueba_inmutable` y `lane_toma_prueba_del_heat` NO se tocan. El carril
-- sigue heredando la prueba de su heat por trigger, y cambiarle la prueba a un
-- heat que ya tiene carriles sigue prohibido: la UI no ofrece cambiarla, se
-- borra el heat y se crea de nuevo.

-- ---------------------------------------------------------------------------
-- 3. La distribucion automatica reparte por (PRUEBA x CATEGORIA)
-- ---------------------------------------------------------------------------
--
-- Ademas de pasar la prueba explicita, cierra dos bugs que solo aparecen con
-- mas de una:
--
--   a) El filtro de equipos elegibles descartaba a quien ya tuviera carril en
--      CUALQUIER heat largado. Apenas largaba el WOD 1, la distribucion del
--      WOD 2 no asignaba a NADIE: los equipos ya habian corrido "un" heat.
--      Ahora el descarte es por prueba, asi que haber corrido el WOD 1 no saca
--      a nadie del WOD 2.
--
--   b) El borrado de heats sin largar tampoco estaba acotado por prueba, asi
--      que distribuir el WOD 2 BORRABA los heats ya armados del WOD 1.
--
-- EL DROP ES OBLIGATORIO, no una precaucion: create or replace no reemplaza una
-- funcion si cambia la aridad, y aca cambian la aridad Y el returns table. Sin
-- el drop quedarian dos funciones con el mismo nombre y toda llamada reventaria
-- con "is not unique" — la misma trampa que ya mordio con
-- admin_create_registration (20260904400100).
drop function if exists public.auto_distribuir_heats(uuid, int);

create or replace function public.auto_distribuir_heats(
  p_event_id uuid,
  p_lanes_por_heat int,
  -- null = todas las pruebas del evento.
  p_workout_id uuid default null
)
returns table (
  workout_id uuid,
  workout_name text,
  division_id uuid,
  division_name text,
  heats_creados int,
  equipos_asignados int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workout record;
  v_division record;
  v_team_ids uuid[];
  v_judge_ids uuid[];
  v_numeros_ocupados int[];
  v_heat_count int;
  v_siguiente int;
  v_i int;
  v_lane_num int;
  v_team_idx int;
  v_new_heat_id uuid;
  v_judge_idx int;
  v_heat_prev_judges uuid[];
  v_heat_actual_judges uuid[];
  v_candidate uuid;
  v_try uuid;
  v_found boolean;
  v_scan int;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'Solo la organización puede distribuir heats automáticamente'
      using errcode = 'insufficient_privilege';
  end if;

  if p_lanes_por_heat is null or p_lanes_por_heat < 1 or p_lanes_por_heat > 32 then
    raise exception 'La cantidad de carriles por heat tiene que estar entre 1 y 32';
  end if;

  if p_workout_id is not null and not exists (
    select 1 from public.workouts w
    where w.id = p_workout_id and w.event_id = p_event_id
  ) then
    raise exception 'Esa prueba no pertenece a esta competencia';
  end if;

  -- El pool de jueces: cualquiera que ya figure en la pantalla de Jueces de
  -- este evento y este aprobado. Puede venir VACIO, y no es un error: los
  -- carriles quedan libres y el organizador los asigna despues. La garantia de
  -- "no se larga un heat sin juez" vive en start_heat(), no aca.
  select array_agg(user_id order by random())
  into v_judge_ids
  from (
    select distinct s.user_id
    from public.event_staff s
    where s.event_id = p_event_id and s.user_id is not null and s.approved_at is not null
  ) jueces;

  v_judge_idx := 1;

  for v_workout in
    select w.id, w.name
    from public.workouts w
    where w.event_id = p_event_id
      and (p_workout_id is null or w.id = p_workout_id)
    order by w.order_index
  loop
    -- Solo las categorias que CORREN esta prueba. part_divisions es la
    -- respuesta a "quien corre que" y es explicita a proposito (ver el
    -- comentario de la tabla en 20260901100000): una categoria que no esta ahi
    -- no corre esta prueba, y no puede tener heats de ella.
    for v_division in
      select d.id, d.name
      from public.divisions d
      where d.event_id = p_event_id
        and exists (
          select 1
          from public.part_divisions pd
          join public.workout_parts wp on wp.id = pd.part_id
          where pd.division_id = d.id and wp.workout_id = v_workout.id
        )
      order by d.name
    loop
      -- El padron de esta categoria PARA ESTA PRUEBA: equipos confirmados,
      -- aprobados, no retirados, que no esten corriendo ya esta misma prueba en
      -- un heat que arranco. Los que ya corrieron OTRA prueba entran igual.
      select array_agg(t.id order by t.bib_number)
      into v_team_ids
      from public.teams t
      where t.division_id = v_division.id
        and t.status <> 'withdrawn'
        and t.approved
        and not exists (
          select 1 from public.lanes l
          join public.heats h on h.id = l.heat_id
          where l.team_id = t.id
            and l.workout_id = v_workout.id
            and h.started_at is not null
        );

      if v_team_ids is null or array_length(v_team_ids, 1) = 0 then
        continue;
      end if;

      -- Los numeros que ya usa un heat LARGADO de esta prueba y categoria: la
      -- tanda nueva se numera esquivandolos, no empezando de 1 y chocando.
      select coalesce(array_agg((regexp_match(h.name, '^Heat (\d+)$'))[1]::int), array[]::int[])
      into v_numeros_ocupados
      from public.heats h
      where h.event_id = p_event_id
        and h.workout_id = v_workout.id
        and h.division_id = v_division.id
        and h.started_at is not null
        and h.name ~ '^Heat \d+$';

      -- Se borran los heats de ESTA prueba y categoria que todavia no
      -- arrancaron: es lo que hace que correr esto de nuevo sea un recalculo y
      -- no una duplicacion. El cascade se lleva sus carriles.
      delete from public.heats h
      where h.event_id = p_event_id
        and h.workout_id = v_workout.id
        and h.division_id = v_division.id
        and h.started_at is null;

      v_heat_count := ceil(array_length(v_team_ids, 1)::numeric / p_lanes_por_heat);
      v_siguiente := 1;
      -- La memoria de jueces se reinicia por (prueba, categoria): "no repetir
      -- juez en heats seguidos" es dentro de una tanda, y dos pruebas distintas
      -- corren en horarios distintos.
      v_heat_prev_judges := array[]::uuid[];

      for v_i in 1..v_heat_count loop
        while v_siguiente = any(v_numeros_ocupados) loop
          v_siguiente := v_siguiente + 1;
        end loop;

        insert into public.heats (event_id, workout_id, division_id, name, lane_count)
        values (
          p_event_id, v_workout.id, v_division.id,
          'Heat ' || v_siguiente, p_lanes_por_heat
        )
        returning id into v_new_heat_id;

        v_heat_actual_judges := array[]::uuid[];

        for v_lane_num in 1..p_lanes_por_heat loop
          v_team_idx := (v_i - 1) * p_lanes_por_heat + v_lane_num;
          exit when v_team_idx > array_length(v_team_ids, 1);

          v_candidate := null;

          if v_judge_ids is not null and array_length(v_judge_ids, 1) > 0 then
            -- Busca, siguiendo la rotacion desde el cursor, el primer juez que
            -- no haya quedado en ESTE heat ni en el ANTERIOR de la tanda.
            v_found := false;
            for v_scan in 0..array_length(v_judge_ids, 1) - 1 loop
              v_try := v_judge_ids[1 + ((v_judge_idx - 1 + v_scan) % array_length(v_judge_ids, 1))];
              if not (v_try = any(v_heat_actual_judges))
                 and not (v_try = any(v_heat_prev_judges)) then
                v_candidate := v_try;
                v_found := true;
                exit;
              end if;
            end loop;

            -- Con pocos jueces puede no haber ninguno que cumpla las dos
            -- condiciones: mejor esfuerzo, se cae a la rotacion plana en vez de
            -- dejar el carril sin juez pudiendo evitarlo.
            if not v_found then
              v_candidate := v_judge_ids[1 + ((v_judge_idx - 1) % array_length(v_judge_ids, 1))];
            end if;

            v_judge_idx := v_judge_idx + 1;
            v_heat_actual_judges := array_append(v_heat_actual_judges, v_candidate);
          end if;

          if v_candidate is not null then
            insert into public.lanes (heat_id, event_id, lane_number, team_id, judge_id, claimed_at, lease_expires_at)
            values (
              v_new_heat_id, p_event_id, v_lane_num, v_team_ids[v_team_idx],
              v_candidate, now(), now() + interval '6 hours'
            );
          else
            -- Sin jueces cargados todavia: el carril queda libre, igual que
            -- cualquier carril que un organizador arma a mano sin asignar.
            insert into public.lanes (heat_id, event_id, lane_number, team_id)
            values (v_new_heat_id, p_event_id, v_lane_num, v_team_ids[v_team_idx]);
          end if;
        end loop;

        v_heat_prev_judges := v_heat_actual_judges;
        v_siguiente := v_siguiente + 1;
      end loop;

      workout_id := v_workout.id;
      workout_name := v_workout.name;
      division_id := v_division.id;
      division_name := v_division.name;
      heats_creados := v_heat_count;
      equipos_asignados := array_length(v_team_ids, 1);
      return next;
    end loop;
  end loop;
end;
$$;

select public.apply_function_lockdown();
