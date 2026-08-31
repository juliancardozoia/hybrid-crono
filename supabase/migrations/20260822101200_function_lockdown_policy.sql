-- Politica de privilegios de funciones, aplicable de forma repetible.
--
-- POR QUE NO ALCANZABA CON REVOCAR UNA VEZ
--
-- Postgres otorga EXECUTE a PUBLIC en CADA `create function`. La migracion
-- 20260822100900 revoco lo que existia en ese momento, pero toda funcion creada
-- despues volvio a nacer abierta — y como Supabase publica el schema public como
-- API REST, eso significa un endpoint invocable por cualquiera con la anon key.
--
-- Paso exactamente eso con verify_results, publish_results y
-- verification_queue: se crearon en la migracion siguiente y quedaron expuestas.
-- Verificaban permisos por dentro, asi que no hubo brecha, pero la primera linea
-- de defensa no puede ser "la funcion se defiende sola".
--
-- En vez de otro revoke puntual, aca va la POLITICA, que se puede volver a
-- aplicar. Cada migracion que agregue funciones termina con:
--
--     select public.apply_function_lockdown();
--
-- La convencion de nombres es la que decide:
--   - devuelve trigger      -> nadie. Los triggers no necesitan EXECUTE.
--   - se llama public_*     -> anon y authenticated. Son las vistas publicas.
--   - cualquier otra        -> solo authenticated.

create or replace function public.apply_function_lockdown()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select
      p.oid::regprocedure as firma,
      p.proname as nombre,
      t.typname as retorno
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.firma);

    -- Esta misma funcion no se expone: la llaman las migraciones, no la app.
    if r.nombre = 'apply_function_lockdown' then
      continue;
    end if;

    -- Una funcion de trigger se dispara con los privilegios del dueño de la
    -- tabla. Otorgarle EXECUTE solo la convertiria en un endpoint REST.
    if r.retorno = 'trigger' then
      continue;
    end if;

    execute format('grant execute on function %s to authenticated', r.firma);

    if r.nombre like 'public\_%' then
      execute format('grant execute on function %s to anon', r.firma);
    end if;
  end loop;
end;
$$;

revoke all on function public.apply_function_lockdown() from public, anon, authenticated;

select public.apply_function_lockdown();
