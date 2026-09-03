-- puede_en_division() necesita SECURITY DEFINER.
--
-- Miraba `event_staff_divisions` con las privilegios del que llama, y esa
-- tabla se lee via `event_staff_divisions_read`, gateada por
-- `event_role(event_id) is not null`. Mientras `event_role()` le devolvia
-- 'judge' a CUALQUIER fila de event_staff con role = 'judge' -- tuviera o no
-- banderas de permiso -- la funcion podia ver sus propias filas de alcance y
-- todo funcionaba por casualidad, no porque la funcion estuviera bien escrita.
--
-- Desde jueces_alcance_acotado.sql, un event_staff con role = 'judge' YA NO
-- tiene event_role() -- es la garantia central de esa migracion -- y
-- `not exists (select ... from event_staff_divisions ...)` paso de "no tiene
-- alcance configurado" a "no puedo ver si tiene alcance configurado", que
-- `puede_en_division` interpreta igual: sin filas visibles, deja pasar
-- CUALQUIER categoria. Un colaborador acotado a una sola categoria quedaba
-- viendo todas.
--
-- La funcion nunca deberia haber dependido de la visibilidad RLS del que
-- llama para leer SU PROPIA configuracion de alcance -- es exactamente lo que
-- las demas funciones de este archivo (event_role, event_staff_role,
-- can_score_event, etc.) ya resuelven con `security definer`. Se le agrega
-- la misma garantia.

create or replace function public.puede_en_division(p_event_id uuid, p_division_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    public.can_manage_event(p_event_id)
    or not exists (
      select 1
      from public.event_staff s
      join public.event_staff_divisions d on d.staff_id = s.id
      where s.event_id = p_event_id and s.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.event_staff s
      join public.event_staff_divisions d on d.staff_id = s.id
      where s.event_id = p_event_id
        and s.user_id = auth.uid()
        and d.division_id = p_division_id
    ),
    false
  );
$$;

select public.apply_function_lockdown();
