-- Los parametros de una categoria: que se levanta y cuanto.
--
-- POR QUE UNA TABLA NUEVA Y NO `division_movement_specs`
--
-- Aquella responde "en ESTA prueba, esta categoria levanta tanto": cuelga de un
-- `part_movement_id`, o sea de un movimiento dentro de un WOD concreto. Es lo
-- que necesita el juez.
--
-- Esto es otra cosa: es el ESTANDAR DECLARADO de la categoria, lo que el
-- organizador publica meses antes para que un atleta decida en cual anotarse.
-- "Elite Masculino: Thruster 43 kg, Clean and Jerk 60 kg, Double-unders" existe
-- antes de que haya una sola prueba cargada, y sigue existiendo aunque las
-- pruebas cambien. Meterlo en la otra tabla obligaria a inventar un WOD falso
-- para poder guardarlo.
--
-- KILOS O LIBRAS
--
-- Se guarda SIEMPRE en kilos —es la unidad canonica y la que compara el motor de
-- puntuacion— mas la unidad en la que el organizador lo escribio. Guardar el
-- numero tal cual y la unidad al lado obligaria a convertir en cada lectura y a
-- acordarse siempre; guardar solo kilos perderia que "95 lb" es el numero
-- redondo del reglamento y se mostraria como "43,09 kg", que no significa nada
-- para quien programo la prueba en libras.

-- Libras o kilos. Un enum y no un texto libre: son dos, y con texto libre
-- terminan conviviendo "kg", "Kg", "kilos" y "KG" en la misma tabla.
create type public.load_unit as enum ('kg', 'lb');

create table public.division_movements (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null,
  event_id uuid not null,
  order_index int not null default 0 check (order_index >= 0),

  -- Del catalogo, o escrito a mano cuando falta. Igual que en `part_movements`:
  -- el organizador selecciona, y cuando no encuentra el suyo lo escribe.
  movement_id uuid references public.movements (id) on delete restrict,
  custom_name text,

  -- Canonico. Null = el movimiento no lleva peso (un burpee, un double-under).
  load_kg numeric(7, 2) check (load_kg >= 0),
  -- En que unidad lo escribio el organizador, para devolverselo igual.
  load_unit public.load_unit not null default 'kg',

  -- Para lo que no es peso: "24 pulgadas" en un box jump, "60 cm" en un salto.
  spec text,
  notes text,

  created_at timestamptz not null default now(),
  unique (id, event_id),
  constraint division_movement_tiene_nombre
    check ((movement_id is not null) <> (custom_name is not null)),
  -- El mismo movimiento dos veces en la misma categoria es siempre un error de
  -- carga, no una intencion.
  unique (division_id, movement_id),
  foreign key (division_id, event_id)
    references public.divisions (id, event_id) on delete cascade
);

create index division_movements_division_idx
  on public.division_movements (division_id, order_index);

alter table public.division_movements enable row level security;

create policy division_movements_read on public.division_movements
  for select using (public.event_role(event_id) is not null);
create policy division_movements_write on public.division_movements
  for all using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));

revoke all on public.division_movements from anon, authenticated;
grant select, insert, update, delete on public.division_movements to authenticated;

select public.apply_function_lockdown();
