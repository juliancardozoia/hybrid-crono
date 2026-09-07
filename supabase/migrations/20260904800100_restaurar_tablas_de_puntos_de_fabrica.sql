-- La migracion anterior (limpieza total de datos) truncaba `organizations`
-- con CASCADE, y `scoring_tables.org_id references organizations(id)`
-- significa que Postgres arrastro la tabla ENTERA en el cascade -- TRUNCATE
-- CASCADE no filtra por fila, trunca la tabla completa apenas tiene una FK
-- hacia algo que se esta truncando. El `delete ... where org_id is not
-- null` de esa misma migracion nunca llego a importar: para cuando corrio,
-- las 4 filas de fabrica (org_id null) ya habian desaparecido con el
-- truncate de mas arriba en el mismo statement.
--
-- Se restauran con el mismo INSERT original de
-- 20260901100000_pruebas_y_movimientos.sql. Los puntos de estas tablas no
-- viven en la fila (`points` queda vacio a proposito): salen de
-- `src/shared/scoring/points.ts` segun `builtin_key`, asi que no hay nada
-- mas que reconstruir.
insert into public.scoring_tables (org_id, name, builtin_key) values
  (null, 'Tiempo total', 'tiempo_total'),
  (null, 'CF-Games 40', 'cf_games_40'),
  (null, 'CF-Games 80', 'cf_games_80'),
  (null, 'CF-Open', 'cf_open')
on conflict do nothing;
