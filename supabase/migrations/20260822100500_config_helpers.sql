-- Ayudantes para la configuracion de la competencia.

-- Reordena los segmentos de un circuito en una sola operacion.
--
-- No se puede hacer con updates sueltos desde el cliente: `unique
-- (course_template_id, order_index)` hace que cualquier intercambio choque a
-- mitad de camino. Aca se corren todos los indices fuera de rango primero y
-- despues se asignan los definitivos, todo dentro de la misma transaccion.
--
-- El offset es una suma y no un negativo porque la tabla tiene
-- `check (order_index >= 0)`: restar violaria la constraint en el paso
-- intermedio.
create or replace function public.reorder_segments(
  p_template_id uuid,
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
  select event_id into v_event_id
  from public.course_templates
  where id = p_template_id;

  if v_event_id is null then
    raise exception 'La plantilla de circuito no existe';
  end if;

  if not public.can_manage_event(v_event_id) then
    raise exception 'No tienes permiso para editar este circuito'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_total
  from public.segments where course_template_id = p_template_id;

  v_recibidos := coalesce(array_length(p_ordered_ids, 1), 0);

  -- Una lista incompleta dejaria segmentos con indices basura. Mejor rechazarla
  -- entera que aplicar un reordenamiento a medias.
  if v_recibidos <> v_total then
    raise exception 'La lista tiene % segmentos y el circuito tiene %', v_recibidos, v_total;
  end if;

  update public.segments
  set order_index = order_index + 100000
  where course_template_id = p_template_id;

  for i in 1..v_recibidos loop
    update public.segments
    set order_index = i - 1
    where id = p_ordered_ids[i]
      and course_template_id = p_template_id;
  end loop;

  if exists (
    select 1 from public.segments
    where course_template_id = p_template_id and order_index >= 100000
  ) then
    raise exception 'La lista de orden no corresponde a los segmentos del circuito';
  end if;
end;
$$;

grant execute on function public.reorder_segments(uuid, uuid[]) to authenticated;
