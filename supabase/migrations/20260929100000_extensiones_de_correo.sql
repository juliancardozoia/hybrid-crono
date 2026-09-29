-- Habilita pg_cron y pg_net: lo que necesita el barrido de reintentos de
-- correos (`interno_agendar_barrido_de_correos`, en 20260926100000_correos.sql).
--
-- Se podrian activar a mano desde el dashboard (Database > Extensions, dos
-- clicks) pero eso deja la configuracion sin versionar -- exactamente lo que
-- este proyecto evita en todos lados. `create extension` es una sentencia SQL
-- comun, no requiere el dashboard.
--
-- GUARDADO CON `pg_available_extensions`, mismo patron que el guard de
-- `storage` en 20260901102100_perfil_y_organizacion.sql: Supabase de verdad las
-- trae disponibles, PGlite (los 700+ tests de supabase/tests/) no. Sin el
-- guard, esta migracion rompe la suite entera con "extension pg_cron is not
-- available" -- el mismo problema que motivo el guard de storage.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end;
$$;
