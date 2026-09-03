-- Reusar los jueces que ya trabajaron en otras competencias de la organizacion.
--
-- EL PROBLEMA DE INVITAR POR EVENTO
--
-- Que un juez tenga acceso a UN evento y no a todos es la decision correcta: es
-- lo que permite contratar a alguien para una fecha sin darle de paso el
-- historial completo de la organizacion, y lo que hace posible correr dos
-- competencias en simultaneo sin que los jueces de una vean los carriles de la
-- otra.
--
-- Su unico costo real es la carga administrativa: un box que hace una fecha por
-- mes con los mismos doce jueces tendria que escribir doce correos cada vez. Y
-- ese costo se paga una sola vez si el sistema RECUERDA quien ya trabajo con
-- vos.
--
-- Esta funcion es ese recuerdo. No cambia el modelo de permisos —el acceso
-- sigue siendo por evento— solo evita volver a tipear.
--
-- QUE NO DEVUELVE: a quien ya esta en ESTE evento. Ofrecer invitar a alguien que
-- ya esta es una fila que no hace nada y que hay que leer igual.

create or replace function public.org_staff_directory(p_event_id uuid)
returns table (
  email text,
  nombre text,
  user_id uuid,
  -- En cuantas competencias de la organizacion trabajo. Ordena la lista: los
  -- de siempre arriba.
  veces bigint,
  ultima_competencia text,
  ultima_fecha timestamptz,
  -- Si en aquellas era juez (sin permisos) o colaborador. La pantalla ofrece
  -- solo los del tipo que esta agregando.
  fue_juez boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mi_org as (
    select e.org_id from public.events e where e.id = p_event_id
  ),
  historial as (
    select
      lower(s.invited_email) as email,
      s.user_id,
      s.event_id,
      e.name as evento,
      s.created_at,
      not (
        s.is_admin or s.can_edit_registrations or s.can_delete_registrations
        or s.can_edit_scores or s.can_manage_workouts
      ) as fue_juez
    from public.event_staff s
    join public.events e on e.id = s.event_id
    where e.org_id = (select org_id from mi_org)
      and s.event_id <> p_event_id
      -- A quien ya esta en este evento no se lo ofrece de nuevo.
      and not exists (
        select 1 from public.event_staff ya
        where ya.event_id = p_event_id
          and lower(ya.invited_email) = lower(s.invited_email)
      )
  )
  -- El nombre se busca DESPUES de agrupar. Dentro del `group by` no se puede:
  -- `user_id` no esta agrupado, y ademas no existe `max(uuid)` en Postgres —
  -- para quedarse con uno de varios hay que usar `array_agg(...)[1]`.
  select
    d.email,
    coalesce(
      (select nullif(trim(p.full_name), '') from public.profiles p where p.id = d.user_id),
      d.email
    ) as nombre,
    d.user_id,
    d.veces,
    d.ultima_competencia,
    d.ultima_fecha,
    d.fue_juez
  from (
    select
      h.email,
      (array_agg(h.user_id) filter (where h.user_id is not null))[1] as user_id,
      count(distinct h.event_id) as veces,
      (array_agg(h.evento order by h.created_at desc))[1] as ultima_competencia,
      max(h.created_at) as ultima_fecha,
      -- Basta con que haya sido juez alguna vez: alguien puede haber sido
      -- colaborador en una competencia y juez en otra, y tiene sentido en las
      -- dos listas.
      bool_or(h.fue_juez) as fue_juez
    from historial h
    group by h.email
  ) d
  -- Solo lo ve quien administra este evento: es el historial de contactos de la
  -- organizacion, no una lista publica.
  where coalesce(public.can_manage_event(p_event_id), false)
  order by d.veces desc, d.ultima_fecha desc;
$$;

select public.apply_function_lockdown();
