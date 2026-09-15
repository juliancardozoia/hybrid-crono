-- El boton "Juzgar" aparecia en el menu de CUALQUIER cuenta logueada, sin
-- importar si esa persona fue agregada como staff de alguna competencia. Con
-- eso cualquiera podia entrar a /juez y ver la pantalla de seleccion de
-- carril (vacia, pero visible) aunque nunca lo hubieran invitado a nada.
--
-- `puede_juzgar()` es el chequeo que la UI necesita para decidir si mostrar
-- el boton, y replica el MISMO gate que ya aplica `claim_lane` (ver
-- 20260903100200_jueces_alcance_acotado.sql): aprobado en `event_staff` de
-- ESE evento, y ademas -- para el rol llano de juez -- que la organizacion
-- no haya apagado la autoasignacion (`events.allow_judge_self_claim`).
-- `manager` y `verifier` quedan afuera de esa segunda condicion porque
-- `claim_lane` los deja pasar siempre via `can_verify_event`, autoasignacion
-- prendida o apagada: el toggle restringe a los JUECES, no a quien ya
-- administra la competencia (ver el comentario grande de la migracion de
-- jueces verificados).
--
-- No hace falta mirar `org_members`: un dueño u admin de organizacion entra
-- por el panel, no por este boton, y ya tiene su propio acceso.
create or replace function public.puede_juzgar()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.event_staff s
    join public.events e on e.id = s.event_id
    where s.user_id = auth.uid()
      and s.approved_at is not null
      and (
        e.allow_judge_self_claim
        or s.role in ('manager', 'verifier')
      )
  );
$$;

select public.apply_function_lockdown();
