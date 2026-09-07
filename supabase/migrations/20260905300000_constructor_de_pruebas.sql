-- El constructor de pruebas: unidad de carga, estilo de captura y reordenar.
--
-- Hasta aca una prueba se podia CREAR y BORRAR, y nada mas. No habia forma de
-- corregirle el cap, de agregarle una parte B, de mover un movimiento de lugar
-- ni de cargar el peso que levanta cada categoria — `division_movement_specs`
-- es la tabla que hace Rx contra Scaled, la leen el juez y el recalculo, y no
-- tenia ni un solo camino de escritura en la app.

-- ---------------------------------------------------------------------------
-- 1. En que unidad se escribio el peso
-- ---------------------------------------------------------------------------
--
-- `load_kg` sigue siendo el valor canonico: es el que compara el motor y el que
-- usa el resto del esquema. Lo que faltaba es recordar como lo escribio el
-- organizador, que es lo que `division_movements` ya hacia desde
-- 20260901102300 y estas dos tablas no.
--
-- Sin esto, el juez lee "43.09 kg" en la pantalla donde el atleta y la pizarra
-- dicen "95 lb". El default 'kg' es correcto para todo lo ya cargado: no habia
-- otra opcion posible.
alter table public.part_movements
  add column load_unit public.load_unit not null default 'kg';

alter table public.division_movement_specs
  add column load_unit public.load_unit not null default 'kg';

-- ---------------------------------------------------------------------------
-- 2. Como cuenta el juez ESE movimiento
-- ---------------------------------------------------------------------------
--
-- Hoy lo decide una funcion en la pantalla del juez que mira solo la UNIDAD:
-- metros, calorias y segundos se escriben; todo lo demas se tapea. Es correcto
-- para 500 m de remo y falso para 100 double-unders — tapear cien veces le saca
-- la vista del atleta cien veces, que es justo lo que la pantalla no puede
-- hacer.
--
--   tap      un toque por repeticion. El paso se cierra solo al llegar al
--            objetivo. 21-15-9 thrusters, 10 wall balls por ronda.
--   hecho    un solo toque cuando termina. 50 wall balls, 100 double-unders.
--   numero   se escribe la cantidad. 500 m de remo, 30 calorias.
--
-- NULLABLE Y SIN DEFAULT A PROPOSITO. `null` significa "el derivado", no "tap".
-- Con un default congelado en el insert, mejorar la regla de derivacion despues
-- no alcanzaria a ninguna fila ya creada. Es el mismo criterio que
-- `division_movement_specs`: ausencia = heredar.
--
-- La regla vive en `planDelWod()` (src/shared/timing/wod.ts) y no aca, porque
-- depende del OBJETIVO DE LA RONDA: 21-15-9 son tres objetivos del mismo
-- movimiento y solo estan resueltos cuando el plan se despliega.
create type public.capture_style as enum ('tap', 'hecho', 'numero');

alter table public.part_movements
  add column capture_style public.capture_style;

-- ---------------------------------------------------------------------------
-- 3. Reordenar
-- ---------------------------------------------------------------------------
--
-- Las tres son calcadas de `reorder_segments` (20260822100500) y existen por lo
-- mismo: `unique (padre, order_index)` hace que cualquier intercambio con
-- updates sueltos choque a mitad de camino. Se corren todos los indices fuera
-- de rango primero y despues se asignan los definitivos, en una transaccion.
--
-- El offset SUMA y no resta: las tres tablas tienen `check (order_index >= 0)`
-- y un negativo violaria la constraint en el paso intermedio.

create or replace function public.reorder_workouts(
  p_event_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total int;
  v_recibidos int;
  i int;
begin
  if not public.can_manage_event(p_event_id) then
    raise exception 'No tienes permiso para editar esta competencia'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_total from public.workouts where event_id = p_event_id;
  v_recibidos := coalesce(array_length(p_ordered_ids, 1), 0);

  if v_recibidos <> v_total then
    raise exception 'La lista tiene % pruebas y la competencia tiene %', v_recibidos, v_total;
  end if;

  update public.workouts
  set order_index = order_index + 100000
  where event_id = p_event_id;

  for i in 1..v_recibidos loop
    update public.workouts
    set order_index = i - 1
    where id = p_ordered_ids[i] and event_id = p_event_id;
  end loop;

  if exists (
    select 1 from public.workouts
    where event_id = p_event_id and order_index >= 100000
  ) then
    raise exception 'La lista de orden no corresponde a las pruebas de esta competencia';
  end if;
end;
$$;

create or replace function public.reorder_part_blocks(
  p_part_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_total int;
  v_recibidos int;
  i int;
begin
  select event_id into v_event_id from public.workout_parts where id = p_part_id;

  if v_event_id is null then
    raise exception 'La prueba no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para editar esta prueba'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_total from public.part_blocks where part_id = p_part_id;
  v_recibidos := coalesce(array_length(p_ordered_ids, 1), 0);

  if v_recibidos <> v_total then
    raise exception 'La lista tiene % bloques y la prueba tiene %', v_recibidos, v_total;
  end if;

  update public.part_blocks
  set order_index = order_index + 100000
  where part_id = p_part_id;

  for i in 1..v_recibidos loop
    update public.part_blocks
    set order_index = i - 1
    where id = p_ordered_ids[i] and part_id = p_part_id;
  end loop;

  if exists (
    select 1 from public.part_blocks
    where part_id = p_part_id and order_index >= 100000
  ) then
    raise exception 'La lista de orden no corresponde a los bloques de esta prueba';
  end if;
end;
$$;

create or replace function public.reorder_part_movements(
  p_block_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_total int;
  v_recibidos int;
  i int;
begin
  select event_id into v_event_id from public.part_blocks where id = p_block_id;

  if v_event_id is null then
    raise exception 'El bloque no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para editar esta prueba'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_total from public.part_movements where block_id = p_block_id;
  v_recibidos := coalesce(array_length(p_ordered_ids, 1), 0);

  if v_recibidos <> v_total then
    raise exception 'La lista tiene % movimientos y el bloque tiene %', v_recibidos, v_total;
  end if;

  update public.part_movements
  set order_index = order_index + 100000
  where block_id = p_block_id;

  for i in 1..v_recibidos loop
    update public.part_movements
    set order_index = i - 1
    where id = p_ordered_ids[i] and block_id = p_block_id;
  end loop;

  if exists (
    select 1 from public.part_movements
    where block_id = p_block_id and order_index >= 100000
  ) then
    raise exception 'La lista de orden no corresponde a los movimientos de este bloque';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Los pesos y las cantidades de cada categoria, en una sola escritura
-- ---------------------------------------------------------------------------
--
-- Es la grilla "movimiento x categoria" de la pantalla, con UN solo boton al
-- pie. Existe como funcion y no como N upserts desde el cliente por lo mismo
-- que `assign_heat_lanes`: supabase-js no tiene transacciones, y un fallo a
-- mitad dejaria media tabla con el peso nuevo y media con el viejo — con el
-- juez y el recalculo leyendo numeros distintos para el mismo movimiento.
--
-- REEMPLAZA TODO lo de la parte, no hace un merge. La pantalla manda la grilla
-- entera, asi que lo que no viene es lo que el organizador borro. Es la misma
-- semantica que `event_staff_divisions` al editar un colaborador.
--
-- Una celda VACIA borra el ajuste y vuelve al valor base del movimiento, que es
-- lo que `armarEstructuraDeWod` resuelve con `spec ?? movimiento`. Guardarla
-- como cero diria "cero kilos", que es otra cosa — el mismo criterio que ya
-- vale para `division_segment_specs`.
--
-- Formato de p_specs:
--   [{ "divisionId": uuid, "partMovementId": uuid,
--      "objetivo": [21,15,9] | null, "cargaKg": 43.09 | null,
--      "cargaUnidad": "kg" | "lb" }]
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
    (division_id, part_movement_id, event_id, target_per_round, load_kg, load_unit)
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
    coalesce((fila ->> 'cargaUnidad')::public.load_unit, 'kg')
  from jsonb_array_elements(coalesce(p_specs, '[]'::jsonb)) as fila
  -- Una fila sin objetivo NI carga no es un ajuste: es una celda vacia.
  -- Los parentesis NO son decorativos: `and` liga mas fuerte que `or`, y sin
  -- ellos la validacion del movimiento se aplicaria a la mitad de la condicion.
  where (
      nullif(fila ->> 'cargaKg', '') is not null
      or jsonb_typeof(fila -> 'objetivo') = 'array'
    )
    -- El movimiento tiene que ser de ESTA parte: el `part_id` no viene en el
    -- payload a proposito, se valida contra la base.
    and (fila ->> 'partMovementId')::uuid in (
      select pm.id from public.part_movements pm where pm.part_id = p_part_id
    );
end;
$$;

select public.apply_function_lockdown();
